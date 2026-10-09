import os
import secrets
import time
from pathlib import Path

import base64
import hashlib

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken

from .db import DATA_DIR


def _load_secret() -> str:
    env = os.environ.get("KOKO_SECRET")
    if env:
        return env
    f = Path(DATA_DIR) / ".secret"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if f.exists():
        return f.read_text().strip()
    s = secrets.token_urlsafe(48)
    f.write_text(s)
    f.chmod(0o600)
    return s


SECRET = _load_secret()
ALGO = "HS256"


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt()).decode()


def check_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode()[:72], hashed.encode())
    except ValueError:
        return False


def make_token(user_id: str, days: int = 30) -> str:
    return jwt.encode({"sub": user_id, "typ": "user", "exp": time.time() + days * 86400}, SECRET, ALGO)


def read_token(token: str | None) -> str | None:
    if not token:
        return None
    try:
        p = jwt.decode(token, SECRET, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None
    return p["sub"] if p.get("typ") == "user" else None


def make_doc_token(doc_id: str, hours: int = 12) -> str:
    return jwt.encode({"doc": doc_id, "typ": "doc", "exp": time.time() + hours * 3600}, SECRET, ALGO)


def make_meet_doc_token(doc_id: str, role: str, code: str, minutes: int = 180) -> str:
    """Lets someone in a meeting open the document being shared there (as viewer or editor) for as long as it is the meeting's shared item."""
    return jwt.encode({"doc": doc_id, "typ": "mdoc", "role": role, "mtg": code, "exp": time.time() + minutes * 60}, SECRET, ALGO)


def read_meet_doc_token(token: str | None, doc_id: str) -> dict | None:
    if not token:
        return None
    try:
        p = jwt.decode(token, SECRET, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None
    return p if p.get("typ") == "mdoc" and p.get("doc") == doc_id and p.get("role") in ("viewer", "editor") else None


def doc_token_valid(token: str | None, doc_id: str) -> bool:
    if not token:
        return False
    try:
        p = jwt.decode(token, SECRET, algorithms=[ALGO])
    except jwt.PyJWTError:
        return False
    return p.get("typ") == "doc" and p.get("doc") == doc_id


class RateLimiter:
    """Tiny in-memory sliding-window limiter (per process)."""

    def __init__(self, limit: int, window: float):
        self.limit, self.window = limit, window
        self.hits: dict[str, list[float]] = {}

    def allow(self, key: str) -> bool:
        now = time.time()
        hits = [t for t in self.hits.get(key, []) if now - t < self.window]
        if len(hits) >= self.limit:
            self.hits[key] = hits
            return False
        hits.append(now)
        self.hits[key] = hits
        return True


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(SECRET.encode() + b"|koko-ai-key-v1").digest())
    return Fernet(key)


def encrypt_secret(plain: str) -> str:
    """Encrypt an API key at rest. Tied to the server secret: if KOKO_SECRET changes, stored keys must be re-entered."""
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_secret(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        return None


def make_mfa_token(user_id: str, minutes: int = 5) -> str:
    return jwt.encode({"sub": user_id, "typ": "mfa", "exp": time.time() + minutes * 60}, SECRET, ALGO)


def read_mfa_token(token: str | None) -> str | None:
    try:
        p = jwt.decode(token or "", SECRET, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None
    return p["sub"] if p.get("typ") == "mfa" else None


def make_state(next_url: str, minutes: int = 10, link: str | None = None) -> str:
    return jwt.encode({"next": next_url, "link": link, "typ": "gstate", "n": secrets.token_urlsafe(8), "exp": time.time() + minutes * 60}, SECRET, ALGO)


def read_state(token: str | None) -> tuple[str, str | None] | None:
    """Returns (next_url, user_id_to_link_or_None)."""
    try:
        p = jwt.decode(token or "", SECRET, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None
    return (p.get("next", "/"), p.get("link")) if p.get("typ") == "gstate" else None
