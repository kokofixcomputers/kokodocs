"""Speech-to-text for voice typing. The browser records a short WAV; this turns it into text.

Providers (first one configured wins, or force one with KOKO_STT_PROVIDER):
  * openai-compatible  KOKO_STT_URL (+ KOKO_STT_KEY, KOKO_STT_MODEL)  any server with /audio/transcriptions
  * mistral            MISTRAL_API_KEY            Voxtral, model voxtral-mini-latest (override: KOKO_STT_MODEL)
  * openai             OPENAI_API_KEY             model whisper-1 (override: KOKO_STT_MODEL)
  * local              pip install faster-whisper; model from KOKO_WHISPER_MODEL (default base.en, ~150 MB, CPU only)
"""
import asyncio
import io
import os
import threading
import wave

import httpx

MISTRAL_URL = "https://api.mistral.ai/v1/audio/transcriptions"
OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions"
MAX_BYTES = 12 * 1024 * 1024


class STTError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _local_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False


def provider() -> str | None:
    forced = os.environ.get("KOKO_STT_PROVIDER", "").strip().lower()
    if forced:
        return forced if forced in {"openai-compatible", "mistral", "openai", "local"} else None
    if os.environ.get("KOKO_STT_URL"):
        return "openai-compatible"
    if os.environ.get("MISTRAL_API_KEY"):
        return "mistral"
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    if _local_available():
        return "local"
    return None


def status() -> dict:
    p = provider()
    return {"available": p is not None, "provider": p}


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


_model = None
_model_lock = threading.Lock()


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


def _local_transcribe(audio: bytes, language: str | None) -> str:
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel

            name = os.environ.get("KOKO_WHISPER_MODEL", "base.en")
            _model = WhisperModel(name, device="cpu", compute_type="int8")
        model = _model
    source = _wav_to_array(audio) if audio[:4] == b"RIFF" else io.BytesIO(audio)
    segments, _ = model.transcribe(source, language=language or None, beam_size=1, vad_filter=True, condition_on_previous_text=False)
    return " ".join(s.text.strip() for s in segments).strip()


async def transcribe(audio: bytes, filename: str = "speech.wav", content_type: str = "audio/wav", language: str | None = None) -> str:
    p = provider()
    language = language or os.environ.get("KOKO_STT_LANGUAGE") or None
    if p is None:
        raise STTError("Voice typing isn't set up on this server", 503)
    if len(audio) > MAX_BYTES:
        raise STTError("That recording is too long", 413)
    if p == "local":
        try:
            return await asyncio.to_thread(_local_transcribe, audio, language)
        except STTError:
            raise
        except Exception as e:
            raise STTError(f"Local transcription failed ({type(e).__name__})") from e
    if p == "mistral":
        return await _remote(MISTRAL_URL, os.environ.get("MISTRAL_API_KEY"), os.environ.get("KOKO_STT_MODEL", "voxtral-mini-latest"), audio, filename, content_type, language)
    if p == "openai":
        return await _remote(OPENAI_URL, os.environ.get("OPENAI_API_KEY"), os.environ.get("KOKO_STT_MODEL", "whisper-1"), audio, filename, content_type, language)
    base = os.environ["KOKO_STT_URL"].rstrip("/")
    url = base if base.endswith("/transcriptions") else base + "/audio/transcriptions"
    return await _remote(url, os.environ.get("KOKO_STT_KEY"), os.environ.get("KOKO_STT_MODEL", "whisper-1"), audio, filename, content_type, language)
