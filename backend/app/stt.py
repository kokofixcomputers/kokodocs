"""Speech-to-text for voice typing. The browser records a short WAV; this turns it into text.

The admin dashboard (Settings, Voice typing) picks the provider, key and model and wins over everything below. With "Automatic" it
falls back to the environment, where the first one configured wins (or force one with KOKO_STT_PROVIDER):
  * groq               GROQ_API_KEY               Whisper on Groq; whisper-large-v3-turbo (default) or whisper-large-v3
  * openai-compatible  KOKO_STT_URL (+ KOKO_STT_KEY, KOKO_STT_MODEL)  any server with /audio/transcriptions
  * mistral            MISTRAL_API_KEY            Voxtral, model voxtral-mini-latest (override: KOKO_STT_MODEL)
  * openai             OPENAI_API_KEY             model whisper-1 (override: KOKO_STT_MODEL)
  * local              pip install faster-whisper; model from KOKO_WHISPER_MODEL (default base.en, ~150 MB, CPU only)
"""
import asyncio
import gc
import io
import os
import threading
import time
import wave
from dataclasses import dataclass

import httpx

from . import sttmodels
from .db import settings_get
from .security import decrypt_secret

MISTRAL_URL = "https://api.mistral.ai/v1/audio/transcriptions"
OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions"
GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_MODELS = ["whisper-large-v3-turbo", "whisper-large-v3"]
LOCAL_MODELS = ["tiny.en", "base.en", "small.en", "medium.en", "small", "medium", "large-v3"]
PROVIDERS = ["groq", "mistral", "openai", "openai-compatible", "local"]
DEFAULT_MODEL = {"groq": "whisper-large-v3-turbo", "mistral": "voxtral-mini-latest", "openai": "whisper-1", "openai-compatible": "whisper-1", "local": "base.en"}
MAX_BYTES = 12 * 1024 * 1024


class STTError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _local_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        import huggingface_hub  # noqa: F401
        return True
    except ImportError:
        return False


@dataclass
class Cfg:
    provider: str
    model: str
    url: str | None = None
    key: str | None = None
    language: str | None = None

    @property
    def ready(self) -> bool:
        if self.provider == "local":
            return _local_available()
        if self.provider == "openai-compatible":
            return bool(self.url)
        return bool(self.key)


def _secret(db, name: str) -> str | None:
    return decrypt_secret(settings_get(db, name)) if db is not None and settings_get(db, name) else None


def config(db=None) -> Cfg | None:
    """What to use right now: the admin's choice if there is one, otherwise whatever the server's environment provides."""
    env = os.environ.get
    language = (settings_get(db, "stt_language") if db is not None else "") or env("KOKO_STT_LANGUAGE") or None
    chosen = settings_get(db, "stt_provider") if db is not None else ""
    if chosen in PROVIDERS:
        model = (settings_get(db, f"stt_model_{chosen}") if db is not None else "") or ""
        if chosen == "groq":
            return Cfg("groq", model if model in GROQ_MODELS else DEFAULT_MODEL["groq"], GROQ_URL, _secret(db, "stt_key_groq") or env("GROQ_API_KEY"), language)
        if chosen == "mistral":
            return Cfg("mistral", model or env("KOKO_STT_MODEL") or DEFAULT_MODEL["mistral"], MISTRAL_URL, _secret(db, "stt_key_mistral") or env("MISTRAL_API_KEY"), language)
        if chosen == "openai":
            return Cfg("openai", model or env("KOKO_STT_MODEL") or DEFAULT_MODEL["openai"], OPENAI_URL, _secret(db, "stt_key_openai") or env("OPENAI_API_KEY"), language)
        if chosen == "openai-compatible":
            return Cfg("openai-compatible", model or env("KOKO_STT_MODEL") or DEFAULT_MODEL["openai-compatible"], settings_get(db, "stt_url") or env("KOKO_STT_URL"), _secret(db, "stt_key_openai-compatible") or env("KOKO_STT_KEY"), language)
        return Cfg("local", model if model and (model in LOCAL_MODELS or sttmodels.is_ready(model)) else env("KOKO_WHISPER_MODEL") or DEFAULT_MODEL["local"], None, None, language)
    forced = env("KOKO_STT_PROVIDER", "").strip().lower()
    if forced and forced not in PROVIDERS:
        return None
    pick = forced or ("openai-compatible" if env("KOKO_STT_URL") else "mistral" if env("MISTRAL_API_KEY") else "openai" if env("OPENAI_API_KEY") else "groq" if env("GROQ_API_KEY") else "local" if _local_available() else "")
    if not pick:
        return None
    if pick == "openai-compatible":
        return Cfg(pick, env("KOKO_STT_MODEL") or "whisper-1", env("KOKO_STT_URL"), env("KOKO_STT_KEY"), language)
    if pick == "local":
        return Cfg(pick, env("KOKO_WHISPER_MODEL") or DEFAULT_MODEL["local"], None, None, language)
    key = {"mistral": env("MISTRAL_API_KEY"), "openai": env("OPENAI_API_KEY"), "groq": env("GROQ_API_KEY")}[pick]
    url = {"mistral": MISTRAL_URL, "openai": OPENAI_URL, "groq": GROQ_URL}[pick]
    model = env("KOKO_STT_MODEL") or DEFAULT_MODEL[pick]
    return Cfg(pick, model, url, key, language)


def draft_model(db=None) -> str | None:
    """The small model that writes the live preview while you talk (the real transcript still comes from the chosen provider),
    or None when previews are switched off or faster-whisper isn't installed here. An English-only model unless another language is set."""
    if db is not None and settings_get(db, "stt_draft") == "off":
        return None
    if not _local_available():
        return None
    c = config(db)
    lang = (c.language if c else None) or ""
    return "tiny.en" if not lang or lang.lower().startswith("en") else "tiny"


_draft_slots = asyncio.Semaphore(2)


async def draft(audio: bytes, language: str | None = None, db=None) -> str:
    """A quick, rough transcript of the audio so far, from the small local model. Never spends API credits."""
    name = draft_model(db)
    if not name:
        raise STTError("Live preview is off", 404)
    if len(audio) > MAX_BYTES:
        raise STTError("That recording is too long", 413)
    c = config(db)
    language = language or (c.language if c else None) or ("en" if name.endswith(".en") else None)
    async with _draft_slots:
        try:
            return await asyncio.to_thread(_local_transcribe, audio, language, name)
        except STTError:
            raise
        except Exception as e:
            raise STTError(f"Live preview failed ({type(e).__name__})") from e


def provider(db=None) -> str | None:
    c = config(db)
    return c.provider if c and c.ready else None


def status(db=None) -> dict:
    c = config(db)
    ok = bool(c and c.ready)
    return {"available": ok, "provider": c.provider if ok else None, "draft": ok and draft_model(db) is not None}


async def _remote(url: str, key: str | None, model: str, audio: bytes, filename: str, content_type: str, language: str | None) -> str:
    data = {"model": model}
    if language:
        data["language"] = language
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(url, headers=headers, data=data, files={"file": (filename, audio, content_type)})
    except httpx.HTTPError as e:
        raise STTError(f"Could not reach the speech service ({type(e).__name__})") from e
    if r.status_code == 401 or r.status_code == 403:
        raise STTError("The speech service rejected the API key", 502)
    if r.status_code == 429:
        raise STTError("The speech service is rate limiting requests. Try again in a moment.", 429)
    if r.status_code >= 400:
        raise STTError(f"The speech service returned an error ({r.status_code})")
    try:
        return (r.json().get("text") or "").strip()
    except ValueError as e:
        raise STTError("Unexpected response from the speech service") from e


_models: dict[str, object] = {}
_used: dict[str, float] = {}   # when each loaded model was last used
_model_lock = threading.Lock()
# A loaded Whisper model keeps its memory (a few hundred MB each) until the server restarts, even if nobody has dictated for hours.
# So a model that hasn't been used for this many seconds is dropped, and loads again (a second or two) the next time it is needed.
# KOKO_STT_IDLE_SECONDS=0 keeps models loaded for good.
IDLE_SECONDS = int(os.environ.get("KOKO_STT_IDLE_SECONDS", "180") or 0)
_janitor: threading.Thread | None = None


def _give_memory_back() -> None:
    gc.collect()
    try:   # glibc keeps freed memory for itself unless asked to return it
        import ctypes

        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


def unload_idle(now: float | None = None, idle: int | None = None) -> list[str]:
    """Drops models not used for `idle` seconds; returns their names."""
    now = now if now is not None else time.time()
    limit = IDLE_SECONDS if idle is None else idle
    if limit <= 0:
        return []
    with _model_lock:
        gone = [n for n in list(_models) if now - _used.get(n, now) > limit]
        for n in gone:
            _models.pop(n, None)
            _used.pop(n, None)
    if gone:
        _give_memory_back()
    return gone


def loaded_models() -> list[str]:
    return sorted(_models)


def _watch() -> None:
    while True:
        time.sleep(30)
        try:
            unload_idle()
        except Exception:
            pass


def _start_janitor() -> None:
    global _janitor
    if IDLE_SECONDS > 0 and _janitor is None:
        _janitor = threading.Thread(target=_watch, name="stt-idle", daemon=True)
        _janitor.start()


def _wav_to_array(audio: bytes):
    """16-bit PCM WAV -> mono float32 at 16 kHz (what Whisper wants). No ffmpeg / PyAV needed."""
    import numpy as np

    with wave.open(io.BytesIO(audio)) as w:
        ch, width, rate, frames = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.readframes(w.getnframes())
    if width != 2:
        raise STTError("Unsupported audio format (expected 16-bit WAV)", 415)
    x = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    if rate != 16000 and len(x):
        n = int(len(x) * 16000 / rate)
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
    return x


def _local_transcribe(audio: bytes, language: str | None, name: str) -> str:
    with _model_lock:
        if name not in _models:
            from faster_whisper import WhisperModel

            _models[name] = WhisperModel(name, device="cpu", compute_type="int8", download_root=str(sttmodels.MODELS_DIR))
            _start_janitor()
        _used[name] = time.time()
        model = _models[name]
    source = _wav_to_array(audio) if audio[:4] == b"RIFF" else io.BytesIO(audio)
    segments, _ = model.transcribe(source, language=language or None, beam_size=1, vad_filter=True, condition_on_previous_text=False)
    text = " ".join(s.text.strip() for s in segments).strip()
    _used[name] = time.time()   # a long recording must not look idle while it is still being worked on
    return text


async def transcribe(audio: bytes, filename: str = "speech.wav", content_type: str = "audio/wav", language: str | None = None, db=None) -> str:
    c = config(db)
    if c is None or not c.ready:
        raise STTError("Voice typing isn't set up on this server", 503)
    language = language or c.language
    if len(audio) > MAX_BYTES:
        raise STTError("That recording is too long", 413)
    if c.provider == "local":
        try:
            return await asyncio.to_thread(_local_transcribe, audio, language, c.model)
        except STTError:
            raise
        except Exception as e:
            raise STTError(f"Local transcription failed ({type(e).__name__})") from e
    url = c.url or ""
    if c.provider == "openai-compatible":
        url = url.rstrip("/")
        url = url if url.endswith("/transcriptions") else url + "/audio/transcriptions"
    return await _remote(url, c.key, c.model, audio, filename, content_type, language)


def builtin_repos() -> dict[str, str]:
    """The repositories behind the short model names (tiny.en, small, large-v3...), so the disk list can show them by name."""
    return {f"Systran/faster-whisper-{n}": n for n in LOCAL_MODELS}


def forget(repo: str) -> None:
    """Drop a deleted model from memory too."""
    short = builtin_repos().get(repo)
    for k in (repo, short):
        _models.pop(k, None) if k else None
        _used.pop(k, None) if k else None
