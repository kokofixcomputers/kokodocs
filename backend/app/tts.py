"""Read aloud (text to speech) for documents and wikis.

By default the browser reads the page with the voices it already has: free, instant, and nothing leaves the device (so encrypted documents work too).
The administrator can switch on a server voice, which gives every device the same one:
  * cloudflare   Workers AI @cf/myshell-ai/melotts (about $0.0002 per minute of speech). Uses the account id and API token set here, or
                 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN from the environment.
The browser sends one sentence or so at a time and this returns an MP3; repeats are served from a small memory cache so reading something twice costs once.
"""
import base64
import hashlib
import os
import re
from collections import OrderedDict

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from .db import get_db, settings_get, settings_set
from .routes import must_admin, must_user
from .security import RateLimiter, decrypt_secret, encrypt_secret

router = APIRouter(prefix="/api")
CF_API = os.environ.get("KOKO_CF_AI_API", "https://api.cloudflare.com/client/v4")   # overridable so tests can use a mock
MODEL = "@cf/myshell-ai/melotts"
LANGS = {"en", "es", "fr", "zh", "ja", "ko"}      # what MeloTTS speaks
MAX_CHARS = 1200
limiter = RateLimiter(240, 60)                    # a person reading a long page asks for a sentence every few seconds
_cache: "OrderedDict[str, bytes]" = OrderedDict()
CACHE_BYTES = 24 * 1024 * 1024
_size = [0]


def cfg(db) -> dict:
    tok = settings_get(db, "tts_cf_token")
    return {
        "engine": settings_get(db, "tts_engine", "browser") if settings_get(db, "tts_engine", "browser") in ("browser", "cloudflare") else "browser",
        "account": settings_get(db, "tts_cf_account") or os.environ.get("CLOUDFLARE_ACCOUNT_ID", ""),
        "token": (decrypt_secret(tok) if tok else "") or os.environ.get("CLOUDFLARE_API_TOKEN", ""),
    }


def problem(c) -> str | None:
    if c["engine"] == "cloudflare" and not (c["account"] and c["token"]):
        return "The Cloudflare voice needs the account id and an API token with Workers AI access."
    return None


def ready(c) -> bool:
    return c["engine"] == "cloudflare" and not problem(c)


async def speak(c, text: str, lang: str) -> bytes:
    key = hashlib.sha1(f"{lang}|{text}".encode()).hexdigest()
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    try:
        async with httpx.AsyncClient(timeout=40, follow_redirects=False) as h:
            r = await h.post(f"{CF_API}/accounts/{c['account']}/ai/run/{MODEL}", json={"prompt": text, "lang": lang}, headers={"Authorization": f"Bearer {c['token']}"})
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Could not reach Cloudflare ({type(e).__name__})")
    if r.status_code in (401, 403):
        raise HTTPException(502, "Cloudflare rejected the API token. It needs the Workers AI permission for this account.")
    if r.status_code >= 400:
        raise HTTPException(502, f"Cloudflare returned an error ({r.status_code}).")
    data = r.content
    ctype = r.headers.get("content-type", "")
    if "json" in ctype:
        try:
            j = r.json()
            b64 = (j.get("result") or j).get("audio")
            data = base64.b64decode(b64) if b64 else b""
        except (ValueError, AttributeError):
            data = b""
    if not data:
        raise HTTPException(502, "Cloudflare returned no audio.")
    _cache[key] = data
    _size[0] += len(data)
    while _size[0] > CACHE_BYTES and _cache:
        _, old = _cache.popitem(last=False)
        _size[0] -= len(old)
    return data


@router.get("/tts/config")
def public_config(db=Depends(get_db)):
    """What the browser needs to know: whether a server voice is on (otherwise it uses its own)."""
    c = cfg(db)
    return {"engine": "cloudflare" if ready(c) else "browser", "langs": sorted(LANGS)}


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_CHARS)
    lang: str = Field("en", max_length=8)


@router.post("/tts")
async def tts(body: SpeakIn, user=Depends(must_user), db=Depends(get_db)):
    c = cfg(db)
    if not ready(c):
        raise HTTPException(409, "The server voice isn't switched on.")
    if not limiter.allow(f"tts:{user['id']}"):
        raise HTTPException(429, "Slow down a little. Try again in a moment.")
    lang = body.lang.lower()[:2]
    if lang not in LANGS:
        lang = "en"
    text = re.sub(r"\s+", " ", body.text).strip()
    if not re.search(r"\w", text):
        raise HTTPException(422, "Nothing to read.")
    return Response(await speak(c, text, lang), media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=3600"})


# ---------------------------------------------------------------- the administrator's settings

def admin_view(db) -> dict:
    c = cfg(db)
    return {"engine": c["engine"], "account": c["account"], "token_set": bool(c["token"]), "problem": problem(c), "model": MODEL}


class AdminIn(BaseModel):
    engine: str | None = Field(None, pattern="^(browser|cloudflare)$")
    account: str | None = Field(None, max_length=40)
    token: str | None = Field(None, max_length=500)    # None or "" keeps the stored one


@router.get("/admin/tts")
def admin_get(admin=Depends(must_admin), db=Depends(get_db)):
    return admin_view(db)


@router.put("/admin/tts")
def admin_put(body: AdminIn, admin=Depends(must_admin), db=Depends(get_db)):
    if body.engine is not None:
        settings_set(db, "tts_engine", body.engine)
    if body.account is not None:
        settings_set(db, "tts_cf_account", body.account.strip())
    if body.token and body.token.strip():
        settings_set(db, "tts_cf_token", encrypt_secret(body.token.strip()))
    db.commit()
    return admin_view(db)


@router.post("/admin/tts/test")
async def admin_test(admin=Depends(must_admin), db=Depends(get_db)):
    c = {**cfg(db), "engine": "cloudflare"}
    if problem(c):
        raise HTTPException(422, problem(c))
    audio = await speak(c, "Reading aloud is working.", "en")
    return {"ok": True, "message": f"Connected: {len(audio) // 1024 or 1} KB of speech came back."}
