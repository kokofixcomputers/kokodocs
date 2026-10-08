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
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import access
from .db import get_db, settings_get
from .routes import ctx, must_admin, must_user
from .security import RateLimiter, decrypt_secret, encrypt_secret

router = APIRouter(prefix="/api")
chat_limiter = RateLimiter(40, 60)
MAX_BODY = 4 * 1024 * 1024
CONNECT_TIMEOUT, READ_TIMEOUT = 15.0, 180.0


def allow_private() -> bool:
    return os.environ.get("KOKO_AI_ALLOW_PRIVATE", "").lower() in {"1", "true", "yes"}


def server_default() -> dict | None:
    """The connection the server's environment provides (KOKO_AI_URL...), used when the admin hasn't set one in the dashboard."""
    url, key = os.environ.get("KOKO_AI_URL"), os.environ.get("KOKO_AI_KEY")
    if url:
        return {"base_url": url, "api_key": key, "model": os.environ.get("KOKO_AI_MODEL", "")}
    return None


def _conn(r) -> dict:
    return {"id": r["id"], "label": r["label"], "scope": r["scope"], "base_url": r["base_url"], "model": r["model"], "api_key": decrypt_secret(r["key_enc"]) if r["key_enc"] else None}


def system_models(db) -> list[dict]:
    """The models the admin offers everyone. With none set up in the dashboard, the environment's connection (KOKO_AI_URL...) is the one."""
    rows = db.execute("SELECT * FROM ai_models WHERE scope = 'system' ORDER BY position, created_at").fetchall()
    if rows:
        return [_conn(r) for r in rows if r["enabled"]]
    d = server_default()
    return [{"id": "env", "label": d["model"] or "Koko", "scope": "system", "base_url": d["base_url"], "model": d["model"], "api_key": d["api_key"]}] if d else []


def own_models(db, user) -> list[dict]:
    return [_conn(r) for r in db.execute("SELECT * FROM ai_models WHERE scope = 'user' AND user_id = ? ORDER BY position, created_at", (user["id"],)).fetchall()]


def available(db, user) -> list[dict]:
    return system_models(db) + own_models(db, user)


def resolve(db, user, wanted: str | None = None) -> dict | None:
    """The model a request should use: the one asked for if this person may use it, else the one they picked, else the admin's first, else their own first."""
    av = available(db, user)
    by_id = {m["id"]: m for m in av}
    if wanted in by_id:
        return by_id[wanted]
    row = db.execute("SELECT ai_model FROM users WHERE id = ?", (user["id"],)).fetchone()
    if row and row["ai_model"] in by_id:
        return by_id[row["ai_model"]]
    return av[0] if av else None


def public_view(db, user) -> dict:
    av = available(db, user)
    cur = resolve(db, user)
    keys = {r["id"]: r["key_enc"] for r in db.execute("SELECT id, key_enc FROM ai_models WHERE scope = 'user' AND user_id = ?", (user["id"],)).fetchall()}
    def item(m):
        own = m["scope"] == "user"
        out = {"id": m["id"], "label": m["label"], "scope": m["scope"], "model": m["model"], "host": urlparse(m["base_url"]).hostname or ""}
        if own:   # their own connection is theirs to see and edit; the key itself never leaves the server
            out |= {"base_url": m["base_url"], "key_hint": ("…" + m["api_key"][-4:]) if m["api_key"] else None}
        return out
    return {"configured": bool(av), "models": [item(m) for m in av], "selected": cur["id"] if cur else None}


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


class ConnIn(BaseModel):
    label: str = Field("", max_length=60)
    base_url: str = Field(max_length=300)
    model: str = Field(max_length=200)
    api_key: str | None = Field(None, max_length=500)   # None = keep the stored key (when editing)


MAX_OWN = 12


@router.get("/ai/settings")
def get_settings(user=Depends(must_user), db=Depends(get_db)):
    return public_view(db, user)


@router.post("/ai/connections")
async def add_connection(body: ConnIn, user=Depends(must_user), db=Depends(get_db)):
    """Add one of your own models (any OpenAI-compatible provider). Only you can see or use it."""
    if db.execute("SELECT COUNT(*) AS n FROM ai_models WHERE scope = 'user' AND user_id = ?", (user["id"],)).fetchone()["n"] >= MAX_OWN:
        raise HTTPException(409, f"That's the most you can add ({MAX_OWN}). Remove one first.")
    if not body.model.strip():
        raise HTTPException(422, "Say which model to use")
    url = await check_url(body.base_url)
    mid = uuid.uuid4().hex[:12]
    key = encrypt_secret(body.api_key.strip()) if body.api_key and body.api_key.strip() else None
    pos = db.execute("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM ai_models WHERE scope = 'user' AND user_id = ?", (user["id"],)).fetchone()["p"]
    db.execute("INSERT INTO ai_models (id, scope, user_id, label, base_url, model, key_enc, enabled, position, created_at) VALUES (?,?,?,?,?,?,?,1,?,?)",
               (mid, "user", user["id"], (body.label.strip() or body.model.strip())[:60], url, body.model.strip(), key, pos, time.time()))
    db.execute("UPDATE users SET ai_model = ? WHERE id = ?", (mid, user["id"]))   # a model you just added is the one you want to try
    db.commit()
    return public_view(db, user)


def _own(db, user, mid: str):
    r = db.execute("SELECT * FROM ai_models WHERE id = ? AND scope = 'user' AND user_id = ?", (mid, user["id"])).fetchone()
    if not r:
        raise HTTPException(404, "No such model of yours")
    return r


@router.put("/ai/connections/{mid}")
async def edit_connection(mid: str, body: ConnIn, user=Depends(must_user), db=Depends(get_db)):
    r = _own(db, user, mid)
    url = await check_url(body.base_url)
    key = r["key_enc"]
    if body.api_key is not None:
        key = encrypt_secret(body.api_key.strip()) if body.api_key.strip() else None
    db.execute("UPDATE ai_models SET label = ?, base_url = ?, model = ?, key_enc = ? WHERE id = ?", ((body.label.strip() or body.model.strip())[:60], url, body.model.strip(), key, mid))
    db.commit()
    return public_view(db, user)


@router.delete("/ai/connections/{mid}")
def delete_connection(mid: str, user=Depends(must_user), db=Depends(get_db)):
    _own(db, user, mid)
    db.execute("DELETE FROM ai_models WHERE id = ?", (mid,))
    db.execute("UPDATE users SET ai_model = '' WHERE id = ? AND ai_model = ?", (user["id"], mid))
    db.commit()
    return public_view(db, user)


class PickIn(BaseModel):
    id: str


@router.put("/ai/selection")
def pick_model(body: PickIn, user=Depends(must_user), db=Depends(get_db)):
    """Which model your assistant uses (also what the model picker in the chat box sets)."""
    if body.id not in {m["id"] for m in available(db, user)}:
        raise HTTPException(404, "That model isn't available to you")
    db.execute("UPDATE users SET ai_model = ? WHERE id = ?", (body.id, user["id"]))
    db.commit()
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


async def fetch_models(s: dict) -> list[str]:
    """Ask a provider which models it offers (also how the connection is tested)."""
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
        return sorted({(m.get("id") if isinstance(m, dict) else str(m)) for m in data if m})
    except Exception:
        raise HTTPException(502, "The provider's model list wasn't in the expected format")


@router.get("/ai/models")
async def list_models(id: str | None = None, user=Depends(must_user), db=Depends(get_db)):
    """The model names a provider offers (for the model box when adding or editing one); defaults to the one you are using."""
    s = resolve(db, user, id)
    if not s:
        raise HTTPException(409, "Connect an AI provider first")
    return {"models": await fetch_models(s)}


class ChatIn(BaseModel):
    model_id: str | None = None   # which of the person's available models to use (else the one they picked)
    messages: list[dict] = Field(max_length=300)
    tools: list[dict] | None = None
    temperature: float | None = Field(None, ge=0, le=2)


@router.post("/ai/chat")
async def chat(body: ChatIn, user=Depends(must_user), db=Depends(get_db)):
    """Relay one chat completion (streamed) to the user's provider. The browser runs the tool loop."""
    if not chat_limiter.allow(f"ai:{user['id']}"):
        raise HTTPException(429, "Slow down: too many assistant requests. Try again in a moment.")
    s = resolve(db, user, body.model_id)
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


# ───────────── admin: the models everyone can use ─────────────
def admin_view(db) -> dict:
    rows = db.execute("SELECT * FROM ai_models WHERE scope = 'system' ORDER BY position, created_at").fetchall()
    env = server_default()
    return {"models": [{"id": r["id"], "label": r["label"], "base_url": r["base_url"], "model": r["model"], "key_set": bool(r["key_enc"]), "enabled": bool(r["enabled"]), "default": i == 0} for i, r in enumerate(rows)],
            "env": {"configured": bool(env), "url": env["base_url"] if env else "", "model": env["model"] if env else ""},
            "using_env": bool(env) and not rows, "people_own": db.execute("SELECT COUNT(*) AS n FROM ai_models WHERE scope = 'user'").fetchone()["n"]}


class GlobalIn(BaseModel):
    label: str = Field("", max_length=60)
    base_url: str | None = Field(None, max_length=300)
    model: str | None = Field(None, max_length=200)
    api_key: str | None = Field(None, max_length=500)
    clear_key: bool | None = None
    enabled: bool | None = None


@router.get("/admin/ai/models")
def admin_list(admin=Depends(must_admin), db=Depends(get_db)):
    return admin_view(db)


@router.post("/admin/ai/models")
async def admin_add(b: GlobalIn, admin=Depends(must_admin), db=Depends(get_db)):
    if not (b.base_url or "").strip() or not (b.model or "").strip():
        raise HTTPException(422, "Give the provider's address and the model to use")
    url = await check_url(b.base_url)
    mid = uuid.uuid4().hex[:12]
    pos = db.execute("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM ai_models WHERE scope = 'system'").fetchone()["p"]
    db.execute("INSERT INTO ai_models (id, scope, user_id, label, base_url, model, key_enc, enabled, position, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
               (mid, "system", None, (b.label.strip() or b.model.strip())[:60], url, b.model.strip(), encrypt_secret(b.api_key.strip()) if b.api_key and b.api_key.strip() else None, int(b.enabled is not False), pos, time.time()))
    db.commit()
    return admin_view(db)


def _sys(db, mid: str):
    r = db.execute("SELECT * FROM ai_models WHERE id = ? AND scope = 'system'", (mid,)).fetchone()
    if not r:
        raise HTTPException(404, "No such model")
    return r


@router.put("/admin/ai/models/{mid}")
async def admin_edit(mid: str, b: GlobalIn, admin=Depends(must_admin), db=Depends(get_db)):
    r = _sys(db, mid)
    sets: dict = {}
    if b.label.strip():
        sets["label"] = b.label.strip()[:60]
    if b.base_url is not None:
        sets["base_url"] = await check_url(b.base_url)
    if b.model is not None:
        if not b.model.strip():
            raise HTTPException(422, "Say which model to use")
        sets["model"] = b.model.strip()
    if b.api_key is not None and b.api_key.strip():
        sets["key_enc"] = encrypt_secret(b.api_key.strip())
    if b.clear_key:
        sets["key_enc"] = None
    if b.enabled is not None:
        sets["enabled"] = int(b.enabled)
    if sets:
        db.execute(f"UPDATE ai_models SET {', '.join(k + ' = ?' for k in sets)} WHERE id = ?", (*sets.values(), mid))
        db.commit()
    return admin_view(db)


@router.delete("/admin/ai/models/{mid}")
def admin_delete(mid: str, admin=Depends(must_admin), db=Depends(get_db)):
    _sys(db, mid)
    db.execute("DELETE FROM ai_models WHERE id = ?", (mid,))
    db.execute("UPDATE users SET ai_model = '' WHERE ai_model = ?", (mid,))
    db.commit()
    return admin_view(db)


@router.post("/admin/ai/models/{mid}/default")
def admin_default(mid: str, admin=Depends(must_admin), db=Depends(get_db)):
    """The first model is what people get until they pick another."""
    _sys(db, mid)
    low = db.execute("SELECT COALESCE(MIN(position), 0) AS p FROM ai_models WHERE scope = 'system'").fetchone()["p"]
    db.execute("UPDATE ai_models SET position = ? WHERE id = ?", (low - 1, mid))
    db.commit()
    return admin_view(db)


@router.post("/admin/ai/models/{mid}/test")
async def admin_test(mid: str, admin=Depends(must_admin), db=Depends(get_db)):
    r = _sys(db, mid)
    t0 = time.time()
    names = await fetch_models(_conn(r))
    return {"ok": True, "models": names, "ms": int((time.time() - t0) * 1000), "model_ok": not names or r["model"] in names}
