"""AI assistant plumbing: per-user provider settings, a streaming proxy to any OpenAI-compatible API, and saved conversations.

Tools run in the browser (that's where the live document is), so the server only needs to relay chat requests and keep the
API key off the client. Connection comes from the user's own settings, or a shared server default:
  KOKO_AI_URL=https://api.mistral.ai/v1   KOKO_AI_KEY=...   KOKO_AI_MODEL=mistral-large-latest
By default the server refuses to call private / loopback addresses (SSRF protection). Set KOKO_AI_ALLOW_PRIVATE=1 to allow
local model servers such as Ollama or LM Studio.
"""
import asyncio
import ipaddress
import json
import os
import socket
import time
import uuid
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import access
from .db import get_db
from .routes import ctx, must_user
from .security import RateLimiter, decrypt_secret, encrypt_secret

router = APIRouter(prefix="/api")
chat_limiter = RateLimiter(40, 60)
MAX_BODY = 4 * 1024 * 1024
CONNECT_TIMEOUT, READ_TIMEOUT = 15.0, 180.0


def allow_private() -> bool:
    return os.environ.get("KOKO_AI_ALLOW_PRIVATE", "").lower() in {"1", "true", "yes"}


def server_default() -> dict | None:
    url, key = os.environ.get("KOKO_AI_URL"), os.environ.get("KOKO_AI_KEY")
    if url:
        return {"base_url": url, "api_key": key, "model": os.environ.get("KOKO_AI_MODEL", "")}
    return None


async def check_url(url: str) -> str:
    """Validate the provider URL and refuse internal addresses unless explicitly allowed."""
    u = urlparse(url.strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise HTTPException(422, "Enter a full URL such as https://api.mistral.ai/v1")
    if u.username or u.password:
        raise HTTPException(422, "Don't put credentials in the URL; use the API key field")
    if not allow_private():
        if u.scheme != "https":
            raise HTTPException(422, "The provider URL must use https (local servers need KOKO_AI_ALLOW_PRIVATE=1 on the server)")
        try:
            infos = await asyncio.to_thread(socket.getaddrinfo, u.hostname, u.port or 443, type=socket.SOCK_STREAM)
        except socket.gaierror:
            raise HTTPException(422, f"Could not resolve {u.hostname}")
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
                raise HTTPException(422, "That address is on a private network and isn't allowed (set KOKO_AI_ALLOW_PRIVATE=1 on the server to allow local models)")
    return url.strip().rstrip("/")


def user_settings(db, user) -> dict | None:
    row = db.execute("SELECT * FROM ai_settings WHERE user_id = ?", (user["id"],)).fetchone()
    if row:
        return {"base_url": row["base_url"], "model": row["model"], "api_key": decrypt_secret(row["key_enc"]), "source": "user"}
    d = server_default()
    return {**d, "source": "server"} if d else None


def public_view(db, user) -> dict:
    row = db.execute("SELECT * FROM ai_settings WHERE user_id = ?", (user["id"],)).fetchone()
    d = server_default()
    key = decrypt_secret(row["key_enc"]) if row else None
    return {
        "configured": bool(row or d),
        "source": "user" if row else ("server" if d else None),
        "base_url": row["base_url"] if row else (d["base_url"] if d else ""),
        "model": row["model"] if row else (d["model"] if d else ""),
        "key_hint": ("…" + key[-4:]) if key else None,
        "server_default": bool(d),
    }


class SettingsIn(BaseModel):
    base_url: str = Field(max_length=300)
    model: str = Field("", max_length=200)
    api_key: str | None = Field(None, max_length=500)  # None = keep the stored key


@router.get("/ai/settings")
def get_settings(user=Depends(must_user), db=Depends(get_db)):
    return public_view(db, user)


@router.put("/ai/settings")
async def put_settings(body: SettingsIn, user=Depends(must_user), db=Depends(get_db)):
    url = await check_url(body.base_url)
    row = db.execute("SELECT key_enc FROM ai_settings WHERE user_id = ?", (user["id"],)).fetchone()
    key_enc = row["key_enc"] if row else None
    if body.api_key is not None:
        key_enc = encrypt_secret(body.api_key.strip()) if body.api_key.strip() else None
    db.execute(
        """INSERT INTO ai_settings (user_id, base_url, model, key_enc, updated_at) VALUES (?,?,?,?,?)
           ON CONFLICT(user_id) DO UPDATE SET base_url = excluded.base_url, model = excluded.model, key_enc = excluded.key_enc, updated_at = excluded.updated_at""",
        (user["id"], url, body.model.strip(), key_enc, time.time()),
    )
    return public_view(db, user)


@router.delete("/ai/settings")
def delete_settings(user=Depends(must_user), db=Depends(get_db)):
    db.execute("DELETE FROM ai_settings WHERE user_id = ?", (user["id"],))
    return public_view(db, user)


def headers_for(s: dict) -> dict:
    h = {"Content-Type": "application/json"}
    if s.get("api_key"):
        h["Authorization"] = f"Bearer {s['api_key']}"
    return h


def provider_error(r: httpx.Response, body: bytes = b"") -> str:
    msg = ""
    try:
        j = json.loads(body or r.content)
        e = j.get("error", j)
        msg = e.get("message") if isinstance(e, dict) else str(e)
        msg = msg or j.get("message") or ""
    except Exception:
        msg = (body or r.content)[:200].decode("utf-8", "replace")
    names = {401: "The provider rejected the API key", 403: "The provider refused the request", 404: "The provider doesn't know that model or URL", 429: "The provider is rate limiting requests"}
    return f"{names.get(r.status_code, f'The provider returned an error ({r.status_code})')}" + (f": {msg[:300]}" if msg else "")


@router.get("/ai/models")
async def list_models(user=Depends(must_user), db=Depends(get_db)):
    s = user_settings(db, user)
    if not s:
        raise HTTPException(409, "Connect an AI provider first")
    url = await check_url(s["base_url"]) + "/models"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(READ_TIMEOUT, connect=CONNECT_TIMEOUT), follow_redirects=False) as c:
            r = await c.get(url, headers=headers_for(s))
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Could not reach the provider ({type(e).__name__})")
    if r.status_code >= 400:
        raise HTTPException(502, provider_error(r))
    try:
        data = r.json().get("data") or r.json().get("models") or []
        ids = sorted({(m.get("id") if isinstance(m, dict) else str(m)) for m in data if m})
    except Exception:
        raise HTTPException(502, "The provider's model list wasn't in the expected format")
    return {"models": ids}


class ChatIn(BaseModel):
    messages: list[dict] = Field(max_length=300)
    tools: list[dict] | None = None
    temperature: float | None = Field(None, ge=0, le=2)


@router.post("/ai/chat")
async def chat(body: ChatIn, user=Depends(must_user), db=Depends(get_db)):
    """Relay one chat completion (streamed) to the user's provider. The browser runs the tool loop."""
    if not chat_limiter.allow(f"ai:{user['id']}"):
        raise HTTPException(429, "Slow down: too many assistant requests. Try again in a moment.")
    s = user_settings(db, user)
    if not s:
        raise HTTPException(409, "Connect an AI provider in the assistant settings first")
    if not s.get("model"):
        raise HTTPException(409, "Choose a model in the assistant settings")
    payload: dict = {"model": s["model"], "messages": body.messages, "stream": True}
    if body.tools:
        payload["tools"] = body.tools
        payload["tool_choice"] = "auto"
    if body.temperature is not None:
        payload["temperature"] = body.temperature
    raw = json.dumps(payload)
    if len(raw) > MAX_BODY:
        raise HTTPException(413, "That conversation is too large. Start a new one.")
    url = await check_url(s["base_url"]) + "/chat/completions"
    client = httpx.AsyncClient(timeout=httpx.Timeout(READ_TIMEOUT, connect=CONNECT_TIMEOUT), follow_redirects=False)
    try:
        req = client.build_request("POST", url, content=raw, headers=headers_for(s))
        resp = await client.send(req, stream=True)
    except httpx.HTTPError as e:
        await client.aclose()
        raise HTTPException(502, f"Could not reach the provider ({type(e).__name__})")
    if resp.status_code >= 400:
        err = await resp.aread()
        await client.aclose()
        raise HTTPException(502 if resp.status_code != 429 else 429, provider_error(resp, err))

    async def relay():
        try:
            async for chunk in resp.aiter_raw():
                yield chunk
        except (httpx.HTTPError, asyncio.CancelledError):
            pass
        finally:
            await resp.aclose()
            await client.aclose()

    ctype = resp.headers.get("content-type", "text/event-stream")
    return StreamingResponse(relay(), media_type=ctype.split(";")[0], headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ───────────────────────── conversations ─────────────────────────
class ConvIn(BaseModel):
    title: str = Field("New conversation", max_length=120)
    data: list[dict] = Field(max_length=2000)


def conv_view(r, with_data=False) -> dict:
    out = {"id": r["id"], "title": r["title"], "created_at": r["created_at"], "updated_at": r["updated_at"]}
    if with_data:
        out["data"] = json.loads(r["data"])
    return out


@router.get("/docs/{doc_id}/ai/conversations")
def list_conversations(doc_id: str, c=Depends(ctx), user=Depends(must_user), db=Depends(get_db)):
    access.require(db, doc_id, *c)
    rows = db.execute("SELECT * FROM ai_conversations WHERE doc_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 60", (doc_id, user["id"])).fetchall()
    return [conv_view(r) for r in rows]


@router.get("/docs/{doc_id}/ai/conversations/{cid}")
def get_conversation(doc_id: str, cid: str, c=Depends(ctx), user=Depends(must_user), db=Depends(get_db)):
    access.require(db, doc_id, *c)
    r = db.execute("SELECT * FROM ai_conversations WHERE id = ? AND doc_id = ? AND user_id = ?", (cid, doc_id, user["id"])).fetchone()
    if not r:
        raise HTTPException(404, "Conversation not found")
    return conv_view(r, True)


@router.put("/docs/{doc_id}/ai/conversations/{cid}")
def save_conversation(doc_id: str, cid: str, body: ConvIn, c=Depends(ctx), user=Depends(must_user), db=Depends(get_db)):
    access.require(db, doc_id, *c)
    if not (4 <= len(cid) <= 40 and cid.replace("-", "").isalnum()):
        raise HTTPException(422, "Bad conversation id")
    data = json.dumps(body.data)
    if len(data) > 1_500_000:
        raise HTTPException(413, "That conversation is too large to save")
    now = time.time()
    owner = db.execute("SELECT user_id FROM ai_conversations WHERE id = ?", (cid,)).fetchone()
    if owner and owner["user_id"] != user["id"]:
        raise HTTPException(404, "Conversation not found")
    db.execute(
        """INSERT INTO ai_conversations (id, doc_id, user_id, title, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, data = excluded.data, updated_at = excluded.updated_at""",
        (cid, doc_id, user["id"], body.title.strip() or "New conversation", data, now, now),
    )
    db.execute(
        """DELETE FROM ai_conversations WHERE doc_id = ? AND user_id = ? AND id NOT IN
           (SELECT id FROM ai_conversations WHERE doc_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 50)""",
        (doc_id, user["id"], doc_id, user["id"]),
    )
    return {"ok": True}


@router.delete("/docs/{doc_id}/ai/conversations/{cid}")
def delete_conversation(doc_id: str, cid: str, c=Depends(ctx), user=Depends(must_user), db=Depends(get_db)):
    access.require(db, doc_id, *c)
    db.execute("DELETE FROM ai_conversations WHERE id = ? AND doc_id = ? AND user_id = ?", (cid, doc_id, user["id"]))
    return {"ok": True}
