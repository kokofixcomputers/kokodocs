"""Hugging Face speech models kept on this server's disk for local voice typing: add one by name or link, watch it download, delete it.

Local voice typing runs faster-whisper, which needs models in the CTranslate2 format (a model.bin next to config.json). The original
`openai/whisper-*` and `distil-whisper/*` repositories are in a different format, so for those the matching "faster-" repository is offered."""
import os
import re
import shutil
import threading
import time
from pathlib import Path

import httpx

from .db import DATA_DIR

MODELS_DIR = Path(os.environ.get("KOKO_STT_MODELS_DIR") or DATA_DIR / "stt-models")
MB = 1024 * 1024
MAX_BYTES = int(os.environ.get("KOKO_STT_MODEL_MAX_MB", "4096")) * MB
REPO_RE = re.compile(r"^[A-Za-z0-9][\w.-]{0,95}/[A-Za-z0-9][\w.-]{0,95}$")
ALLOW = ["config.json", "preprocessor_config.json", "model.bin", "tokenizer.json", "vocabulary.*"]   # the files faster-whisper reads
HF = "https://huggingface.co"
JOBS: dict[str, dict] = {}
_lock = threading.Lock()


class ModelError(Exception):
    def __init__(self, message: str, suggestion: str | None = None, status: int = 422):
        super().__init__(message)
        self.suggestion, self.status = suggestion, status


def parse_repo(text: str) -> str:
    """A repository id, or the link to its page on huggingface.co."""
    t = text.strip()
    m = re.match(r"^https?://(?:www\.)?huggingface\.co/([^/\s]+/[^/\s?#]+)", t)
    repo = (m.group(1) if m else t).strip("/")
    if not REPO_RE.match(repo):
        raise ModelError("Enter a Hugging Face model like Systran/faster-distil-whisper-small.en, or paste its link.")
    return repo


def dir_for(repo: str) -> Path:
    return MODELS_DIR / ("models--" + repo.replace("/", "--"))


def repo_of(dirname: str) -> str | None:
    if not dirname.startswith("models--"):
        return None
    org, _, name = dirname[len("models--"):].partition("--")
    return f"{org}/{name}" if org and name else None


def _real_files(path: Path) -> set[Path]:
    """The real files behind a model folder. Newer Hugging Face versions keep the big weights in one shared blobs folder and only link
    to them from the model's own folder, so the links have to be followed to count (and later delete) what is really on disk."""
    out: set[Path] = set()
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                rp = (Path(root) / f).resolve()
                if rp.is_file():
                    out.add(rp)
            except OSError:
                pass
    return out


def folder_size(path: Path) -> int:
    total = 0
    for f in _real_files(path):
        try:
            total += f.stat().st_size
        except OSError:
            pass
    return total


def _partial_bytes(since: float) -> int:
    """Bytes of downloads still in progress (they sit in the shared blobs folder until they are complete)."""
    total = 0
    for root, _dirs, files in os.walk(MODELS_DIR):
        for f in files:
            if f.endswith(".incomplete"):
                try:
                    st = os.stat(os.path.join(root, f))
                    if st.st_mtime >= since - 5:
                        total += st.st_size
                except OSError:
                    pass
    return total


def is_ready(repo: str) -> bool:
    """Downloaded completely: the snapshot holds the weights and the config."""
    snaps = dir_for(repo) / "snapshots"
    if not snaps.is_dir():
        return False
    return any((s / "model.bin").exists() and (s / "config.json").exists() for s in snaps.iterdir() if s.is_dir())


async def _api(repo: str) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as c:
            r = await c.get(f"{HF}/api/models/{repo}", params={"blobs": "true"})
    except httpx.HTTPError as e:
        raise ModelError(f"Couldn't reach huggingface.co ({type(e).__name__}). The server needs internet access to download a model.", status=502)
    if r.status_code in (401, 403, 404):   # Hugging Face answers 401 for a name that doesn't exist, so these can't be told apart
        return None
    if r.status_code >= 400:
        raise ModelError(f"Hugging Face answered with an error ({r.status_code}). Try again in a moment.", status=502)
    return r.json()


def _files(info: dict) -> dict[str, int]:
    return {s["rfilename"]: int(s.get("size") or 0) for s in info.get("siblings", [])}


def _is_ct2(files: dict[str, int]) -> bool:
    return "model.bin" in files and "config.json" in files


def _candidates(repo: str) -> list[str]:
    name = repo.split("/", 1)[1]
    base = re.sub(r"^distil-", "distil-whisper-", name) if name.startswith("distil-") else name
    base = re.sub(r"^(faster-)", "", base)
    return [f"Systran/faster-{base}", f"Systran/faster-{name}", f"{repo}-ct2", f"{repo}-ctranslate2"]


async def check(repo: str) -> dict:
    """Make sure the repository is a usable, reasonably sized, public CTranslate2 Whisper model. Returns its file sizes."""
    info = await _api(repo)
    if info is None:
        raise ModelError(f"“{repo}” wasn't found on Hugging Face. Check the spelling; private and gated models can't be added.")
    files = _files(info)
    if not _is_ct2(files):
        suggestion = None
        for cand in dict.fromkeys(_candidates(repo)):
            if cand.lower() == repo.lower():
                continue
            other = await _api(cand)
            if other and _is_ct2(_files(other)):
                suggestion = cand
                break
        raise ModelError("That model isn't in the format local voice typing needs (CTranslate2: a model.bin next to config.json)." + (f" Try {suggestion}, which is the same model converted for it." if suggestion else " Look for a “faster-” or “ct2” version of it."), suggestion)
    wanted = sum(sz for fn, sz in files.items() if fn in ("config.json", "preprocessor_config.json", "model.bin", "tokenizer.json") or fn.startswith("vocabulary."))
    if wanted > MAX_BYTES:
        raise ModelError(f"That model is {wanted // MB} MB, over this server's limit of {MAX_BYTES // MB} MB.")
    return {"size": wanted, "files": files}


def start_download(repo: str, total: int) -> None:
    with _lock:
        if JOBS.get(repo, {}).get("state") == "downloading":
            raise ModelError("That model is already downloading.", status=409)
        JOBS[repo] = {"state": "downloading", "total": total, "started": time.time(), "error": None}

    def run():
        try:
            from huggingface_hub import snapshot_download
            MODELS_DIR.mkdir(parents=True, exist_ok=True)
            snapshot_download(repo, cache_dir=str(MODELS_DIR), allow_patterns=ALLOW)
            with _lock:
                JOBS.pop(repo, None)
        except Exception as e:   # shown next to the model, so say what went wrong
            with _lock:
                JOBS[repo] = {"state": "error", "total": total, "started": time.time(), "error": f"{type(e).__name__}: {str(e)[:160]}"}
    threading.Thread(target=run, daemon=True).start()


def list_models(builtin: dict[str, str]) -> list[dict]:
    """Everything on disk, plus what is downloading right now. `builtin` maps repository id to the short name (tiny.en...)."""
    out: dict[str, dict] = {}
    if MODELS_DIR.is_dir():
        for d in sorted(MODELS_DIR.iterdir()):
            repo = repo_of(d.name)
            if repo and d.is_dir():
                out[repo] = {"repo": repo, "size": folder_size(d), "state": "ready" if is_ready(repo) else "incomplete"}
    with _lock:
        for repo, j in JOBS.items():
            cur = out.get(repo, {"repo": repo, "size": folder_size(dir_for(repo)) if dir_for(repo).exists() else 0})
            size = cur["size"] + (_partial_bytes(j["started"]) if j["state"] == "downloading" else 0)
            out[repo] = {**cur, "size": size, "state": j["state"], "total": j["total"], "error": j["error"]}
    for m in out.values():
        m["name"] = builtin.get(m["repo"], m["repo"])
        m["builtin"] = m["repo"] in builtin
    return sorted(out.values(), key=lambda m: m["repo"].lower())


def delete(repo: str) -> int:
    """Remove a model from disk. Returns the bytes freed."""
    with _lock:
        if JOBS.get(repo, {}).get("state") == "downloading":
            raise ModelError("It is still downloading. Wait for it to finish, then delete it.", status=409)
        JOBS.pop(repo, None)
    d = dir_for(repo)
    if not d.exists() or d.resolve().parent != MODELS_DIR.resolve():
        raise ModelError("That model isn't on this server.", status=404)
    mine = _real_files(d)
    others: set[Path] = set()
    for other in MODELS_DIR.iterdir():
        if other.is_dir() and other.name.startswith("models--") and other != d:
            others |= _real_files(other)
    shutil.rmtree(d, ignore_errors=True)
    shutil.rmtree(MODELS_DIR / ".locks" / d.name, ignore_errors=True)
    freed = 0
    for f in mine - others:   # weights in the shared blobs folder, unless another model also uses them
        try:
            freed += f.stat().st_size
            for sib in f.parent.glob(f.name + ".*"):   # its .lock / .refs / .incomplete leftovers
                sib.unlink(missing_ok=True)
            f.unlink(missing_ok=True)
            if f.parent != MODELS_DIR and not any(f.parent.iterdir()):
                f.parent.rmdir()
        except OSError:
            pass
    return freed
