"""Video and voice meetings.

A meeting is just a room with a link (/m/<code>) and a host. What carries the audio and video is a *provider*, chosen by the administrator and
remembered on each meeting, so switching provider later never breaks a meeting that is already running:

  mesh         Browsers connect to each other directly (WebRTC). This server only introduces them (a signalling WebSocket) and hands out STUN/TURN
               servers, so no media passes through it. Cloudflare's free TURN service (or any TURN server) relays for people behind strict
               networks. Good for small groups (up to ~8 people); it costs the server nothing.
  realtimekit  Cloudflare RealtimeKit: this server creates the meeting and a token per person through Cloudflare's REST API; their SDK in the
               browser does the rest. Scales to bigger rooms; billed by Cloudflare per participant-minute.

A new provider is one class here (`join`, `end`, `problem`, `test`) plus one adapter in frontend/src/meet/. Calls are not end-to-end encrypted
(the server or the provider sees the signalling, and RealtimeKit sees the media), and the meeting page says so.
"""
import asyncio
import json
import os
import secrets
import time
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from . import access
from .db import connect, get_db, settings_get, settings_set
from .routes import must_admin, must_user, current_user
from .security import RateLimiter, decrypt_secret, encrypt_secret

router = APIRouter(prefix="/api")
ws_router = APIRouter()
create_limiter = RateLimiter(20, 3600)
join_limiter = RateLimiter(60, 60)

CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"   # no look-alikes (i l o 0 1)
MESH_MAX = 8
CF_API = os.environ.get("KOKO_CF_API", "https://api.cloudflare.com/client/v4")          # overridable so tests can use a mock
TURN_API = os.environ.get("KOKO_TURN_API", "https://rtc.live.cloudflare.com/v1/turn/keys")
STUN_DEFAULT = "stun:stun.cloudflare.com:3478"
CHAT_MAX = 2000
HISTORY = 60


def new_code() -> str:
    c = "".join(secrets.choice(CODE_ALPHABET) for _ in range(10))
    return f"{c[:3]}-{c[3:7]}-{c[7:]}"


def norm_code(code: str) -> str:
    return (code or "").strip().lower()


# ---------------------------------------------------------------- settings

def _secret(db, key: str) -> str:
    raw = settings_get(db, key)
    return (decrypt_secret(raw) or "") if raw else ""


def cfg(db) -> dict:
    """Everything the administrator can set, with environment fallbacks (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, KOKO_RTK_APP_ID)."""
    return {
        "enabled": settings_get(db, "meet_enabled", "1") == "1",
        "guests": settings_get(db, "meet_guests", "1") == "1",
        "provider": settings_get(db, "meet_provider", "mesh") if settings_get(db, "meet_provider", "mesh") in PROVIDERS else "mesh",
        "turn_mode": settings_get(db, "meet_turn_mode", "none"),            # none | cloudflare | custom
        "turn_key_id": settings_get(db, "meet_turn_key_id") or os.environ.get("KOKO_TURN_KEY_ID", ""),
        "turn_token": _secret(db, "meet_turn_token") or os.environ.get("KOKO_TURN_TOKEN", ""),
        "turn_urls": settings_get(db, "meet_turn_urls"),
        "turn_user": settings_get(db, "meet_turn_user"),
        "turn_pass": _secret(db, "meet_turn_pass"),
        "rk_account": settings_get(db, "meet_rk_account") or os.environ.get("CLOUDFLARE_ACCOUNT_ID", ""),
        "rk_app": settings_get(db, "meet_rk_app") or os.environ.get("KOKO_RTK_APP_ID", ""),
        "rk_token": _secret(db, "meet_rk_token") or os.environ.get("CLOUDFLARE_API_TOKEN", ""),
        "rk_host": settings_get(db, "meet_rk_host_preset", "group_call_host"),
        "rk_guest": settings_get(db, "meet_rk_guest_preset", "group_call_participant"),
    }


# ---------------------------------------------------------------- ICE (STUN / TURN) for the mesh provider

_ice_cache: dict[str, tuple[float, list]] = {}


def _usable(urls) -> list[str]:
    out = []
    for u in urls if isinstance(urls, list) else [urls]:
        if isinstance(u, str) and not u.split("?")[0].rstrip("/").endswith(":53"):   # browsers block port 53 and wait for it to time out
            out.append(u)
    return out


async def ice_servers(c: dict) -> list[dict]:
    base = [{"urls": [STUN_DEFAULT]}]
    if c["turn_mode"] == "cloudflare" and c["turn_key_id"] and c["turn_token"]:
        hit = _ice_cache.get(c["turn_key_id"])
        if hit and hit[0] > time.time():
            return hit[1]
        try:
            async with httpx.AsyncClient(timeout=10) as h:
                r = await h.post(f"{TURN_API}/{c['turn_key_id']}/credentials/generate-ice-servers", json={"ttl": 86400},
                                 headers={"Authorization": f"Bearer {c['turn_token']}"})
            r.raise_for_status()
            servers = [{**s, "urls": _usable(s.get("urls"))} for s in r.json().get("iceServers", []) if _usable(s.get("urls"))]
        except (httpx.HTTPError, ValueError) as e:
            raise HTTPException(502, f"Could not get relay servers from Cloudflare ({type(e).__name__})")
        if not servers:
            raise HTTPException(502, "Cloudflare sent back no relay servers")
        _ice_cache[c["turn_key_id"]] = (time.time() + 6 * 3600, servers)   # credentials last a day; people join with at least 18 hours left
        return servers
    if c["turn_mode"] == "custom" and c["turn_urls"].strip():
        urls = _usable([u.strip() for u in c["turn_urls"].replace(",", "\n").splitlines() if u.strip()])
        extra = {"urls": urls}
        if c["turn_user"]:
            extra.update(username=c["turn_user"], credential=c["turn_pass"])
        return [*base, extra] if urls else base
    return base


# ---------------------------------------------------------------- providers

class Mesh:
    id = "mesh"
    label = "Direct between browsers (peer to peer)"

    @staticmethod
    def problem(c) -> str | None:
        if c["turn_mode"] == "cloudflare" and not (c["turn_key_id"] and c["turn_token"]):
            return "Relay servers are set to Cloudflare but the TURN key id or token is missing."
        return None

    @staticmethod
    async def join(db, m, user, name: str, host: bool) -> dict:
        c = cfg(db)
        return {"provider": "mesh", "ice_servers": await ice_servers(c), "max": MESH_MAX}

    @staticmethod
    async def end(db, m) -> None:
        return None

    @staticmethod
    async def test(db) -> dict:
        c = cfg(db)
        servers = await ice_servers(c)
        turn = any(any(str(u).startswith(("turn:", "turns:")) for u in s["urls"]) for s in servers)
        return {"ok": True, "message": ("Relay servers are working." if turn else "Works, with STUN only. People on strict networks (some offices, mobile networks) may not connect without a TURN relay."), "turn": turn}


class RealtimeKit:
    id = "realtimekit"
    label = "Cloudflare RealtimeKit"

    @staticmethod
    def problem(c) -> str | None:
        if not (c["rk_account"] and c["rk_app"] and c["rk_token"]):
            return "RealtimeKit needs the account id, app id and API token (Admin → Meetings)."
        return None

    @staticmethod
    def _call(c, method: str, path: str, body: dict | None = None):
        url = f"{CF_API}/accounts/{c['rk_account']}/realtime/kit/{c['rk_app']}{path}"
        return method, url, {"Authorization": f"Bearer {c['rk_token']}"}, body

    @staticmethod
    async def _req(c, method: str, path: str, body: dict | None = None) -> dict:
        method, url, headers, body = RealtimeKit._call(c, method, path, body)
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as h:
                r = await h.request(method, url, json=body, headers=headers)
        except httpx.HTTPError as e:
            raise HTTPException(502, f"Could not reach Cloudflare ({type(e).__name__})")
        try:
            j = r.json()
        except ValueError:
            j = {}
        if r.status_code >= 400 or j.get("success") is False:
            if r.status_code in (401, 403):
                raise HTTPException(502, "Cloudflare rejected the token. It needs the Realtime (or Realtime Admin) permission for this account.")
            why = "; ".join(str(e.get("message", "")) for e in (j.get("errors") or []) if isinstance(e, dict))[:300]
            raise HTTPException(502, f"Cloudflare returned an error ({r.status_code}){': ' + why if why else ''}")
        return j.get("data") or {}

    @staticmethod
    async def join(db, m, user, name: str, host: bool) -> dict:
        c = cfg(db)
        ref = m["provider_ref"]
        if not ref:
            data = await RealtimeKit._req(c, "POST", "/meetings", {"title": (m["title"] or "Meeting")[:100]})
            ref = str(data.get("id") or "")
            if not ref:
                raise HTTPException(502, "Cloudflare did not return a meeting id")
            db.execute("UPDATE meetings SET provider_ref = ? WHERE code = ? AND provider_ref = ''", (ref, m["code"]))
            db.commit()
            ref = db.execute("SELECT provider_ref FROM meetings WHERE code = ?", (m["code"],)).fetchone()["provider_ref"]   # two people joining first: the first one's wins
        who = f"u:{user['id']}" if user else f"g:{secrets.token_hex(8)}"
        data = await RealtimeKit._req(c, "POST", f"/meetings/{ref}/participants", {
            "name": name[:60], "preset_name": c["rk_host"] if host else c["rk_guest"], "custom_participant_id": who})
        token = data.get("token")
        if not token:
            raise HTTPException(502, "Cloudflare did not return a join token")
        return {"provider": "realtimekit", "auth_token": token}

    @staticmethod
    async def end(db, m) -> None:
        if m["provider_ref"]:
            try:
                await RealtimeKit._req(cfg(db), "PATCH", f"/meetings/{m['provider_ref']}", {"status": "INACTIVE"})
            except HTTPException:
                pass   # the meeting is already closed here; Cloudflare's copy ends by itself

    @staticmethod
    async def test(db) -> dict:
        c = cfg(db)
        data = await RealtimeKit._req(c, "POST", "/meetings", {"title": "KokoDocs connection test"})
        if data.get("id"):
            try:
                await RealtimeKit._req(c, "PATCH", f"/meetings/{data['id']}", {"status": "INACTIVE"})
            except HTTPException:
                pass
        return {"ok": True, "message": "Connected: a test meeting was created and closed."}


PROVIDERS = {"mesh": Mesh, "realtimekit": RealtimeKit}


# ---------------------------------------------------------------- REST

def info(db, m, user) -> dict:
    host = db.execute("SELECT name FROM users WHERE id = ?", (m["host_id"],)).fetchone()
    return {"code": m["code"], "title": m["title"], "host_name": host["name"] if host else "", "is_host": bool(user and user["id"] == m["host_id"]),
            "ended": bool(m["ended_at"]), "guests": bool(m["guests"]), "provider": m["provider"], "created_at": m["created_at"]}


def get_meeting(db, code: str):
    m = db.execute("SELECT * FROM meetings WHERE code = ?", (norm_code(code),)).fetchone()
    if not m:
        raise HTTPException(404, "That meeting doesn't exist. Check the link or code.")
    return m


@router.get("/meet/config")
def public_config(db=Depends(get_db)):
    c = cfg(db)
    return {"enabled": c["enabled"], "guests": c["guests"]}


class NewMeeting(BaseModel):
    title: str = Field("", max_length=100)
    guests: bool = True


@router.post("/meet")
def create_meeting(body: NewMeeting, user=Depends(must_user), db=Depends(get_db)):
    c = cfg(db)
    if not c["enabled"]:
        raise HTTPException(403, "Meetings are turned off on this server")
    if not create_limiter.allow(f"meet:{user['id']}"):
        raise HTTPException(429, "You've started a lot of meetings. Try again later.")
    p = PROVIDERS[c["provider"]]
    if p.problem(c):
        raise HTTPException(409, f"Meetings aren't set up yet: {p.problem(c)}")
    code = new_code()
    title = body.title.strip() or f"{user['name']}'s meeting"
    db.execute("INSERT INTO meetings (code, title, host_id, provider, guests, created_at) VALUES (?, ?, ?, ?, ?, ?)",
               (code, title, user["id"], c["provider"], 1 if (body.guests and c["guests"]) else 0, time.time()))
    db.commit()
    return info(db, get_meeting(db, code), user)


@router.get("/meet")
def my_meetings(user=Depends(must_user), db=Depends(get_db)):
    rows = db.execute("SELECT * FROM meetings WHERE host_id = ? AND ended_at IS NULL ORDER BY created_at DESC LIMIT 12", (user["id"],)).fetchall()
    return [info(db, m, user) for m in rows]


@router.get("/meet/{code}")
def meeting_info(code: str, user=Depends(current_user), db=Depends(get_db)):
    c = cfg(db)
    if not c["enabled"]:
        raise HTTPException(403, "Meetings are turned off on this server")
    m = get_meeting(db, code)
    return {**info(db, m, user), "signed_in": bool(user), "can_join": bool(user) or bool(m["guests"] and c["guests"])}


class Join(BaseModel):
    name: str = Field("", max_length=60)


@router.post("/meet/{code}/join")
async def join_meeting(code: str, body: Join, user=Depends(current_user), db=Depends(get_db)):
    c = cfg(db)
    if not c["enabled"]:
        raise HTTPException(403, "Meetings are turned off on this server")
    m = get_meeting(db, code)
    if m["ended_at"]:
        raise HTTPException(410, "This meeting has ended.")
    if not user and not (m["guests"] and c["guests"]):
        raise HTTPException(401, {"code": "login_required", "message": "Sign in to join this meeting"})
    name = (user["name"] if user else body.name).strip()
    if not name:
        raise HTTPException(422, "Enter your name")
    if not join_limiter.allow(f"join:{user['id'] if user else 'guest'}"):
        raise HTTPException(429, "Too many people joining at once. Try again in a minute.")
    p = PROVIDERS.get(m["provider"])
    if not p or p.problem(c):
        raise HTTPException(409, f"This meeting was started with {p.label if p else m['provider']}, which isn't set up any more. Ask the host to start a new one.")
    host = bool(user and user["id"] == m["host_id"])
    return {**await p.join(db, m, user, name, host), "name": name, "host": host, "title": m["title"]}


@router.post("/meet/{code}/end")
async def end_meeting(code: str, user=Depends(must_user), db=Depends(get_db)):
    m = get_meeting(db, code)
    if m["host_id"] != user["id"] and not access.is_admin(user):
        raise HTTPException(403, "Only the host can end the meeting")
    if not m["ended_at"]:
        db.execute("UPDATE meetings SET ended_at = ? WHERE code = ?", (time.time(), m["code"]))
        db.commit()
        if m["provider"] in PROVIDERS:
            await PROVIDERS[m["provider"]].end(db, m)
        await close_room(m["code"], {"t": "ended"})
    return {"ok": True}


# ---------------------------------------------------------------- admin

def admin_view(db) -> dict:
    c = cfg(db)
    return {"enabled": c["enabled"], "guests": c["guests"], "provider": c["provider"],
            "providers": [{"id": p.id, "label": p.label} for p in PROVIDERS.values()],
            "turn": {"mode": c["turn_mode"], "key_id": c["turn_key_id"], "token_set": bool(c["turn_token"]), "urls": c["turn_urls"], "user": c["turn_user"], "pass_set": bool(c["turn_pass"])},
            "rtk": {"account": c["rk_account"], "app": c["rk_app"], "token_set": bool(c["rk_token"]), "host_preset": c["rk_host"], "guest_preset": c["rk_guest"]},
            "problem": PROVIDERS[c["provider"]].problem(c)}


class TurnIn(BaseModel):
    mode: str | None = Field(None, pattern="^(none|cloudflare|custom)$")
    key_id: str | None = Field(None, max_length=80)
    token: str | None = Field(None, max_length=500)    # None or "" keeps the stored one
    urls: str | None = Field(None, max_length=1000)
    user: str | None = Field(None, max_length=200)
    password: str | None = Field(None, max_length=500)


class RtkIn(BaseModel):
    account: str | None = Field(None, max_length=40)
    app: str | None = Field(None, max_length=80)
    token: str | None = Field(None, max_length=500)
    host_preset: str | None = Field(None, max_length=80)
    guest_preset: str | None = Field(None, max_length=80)


class AdminIn(BaseModel):
    enabled: bool | None = None
    guests: bool | None = None
    provider: str | None = None
    turn: TurnIn | None = None
    rtk: RtkIn | None = None


def _put(db, key: str, val: str | None, secret: bool = False):
    """Store a setting. A secret left blank keeps the stored one."""
    if val is None:
        return
    if secret:
        if val.strip():
            settings_set(db, key, encrypt_secret(val.strip()))
    else:
        settings_set(db, key, val.strip())


@router.get("/admin/meet")
def admin_get(admin=Depends(must_admin), db=Depends(get_db)):
    return admin_view(db)


@router.put("/admin/meet")
def admin_put(body: AdminIn, admin=Depends(must_admin), db=Depends(get_db)):
    if body.enabled is not None:
        settings_set(db, "meet_enabled", "1" if body.enabled else "0")
    if body.guests is not None:
        settings_set(db, "meet_guests", "1" if body.guests else "0")
    if body.provider is not None:
        if body.provider not in PROVIDERS:
            raise HTTPException(422, "Unknown provider")
        settings_set(db, "meet_provider", body.provider)
    t = body.turn
    if t:
        _put(db, "meet_turn_mode", t.mode)
        _put(db, "meet_turn_key_id", t.key_id)
        _put(db, "meet_turn_token", t.token, secret=True)
        _put(db, "meet_turn_urls", t.urls)
        _put(db, "meet_turn_user", t.user)
        _put(db, "meet_turn_pass", t.password, secret=True)
        _ice_cache.clear()
    r = body.rtk
    if r:
        _put(db, "meet_rk_account", r.account)
        _put(db, "meet_rk_app", r.app)
        _put(db, "meet_rk_token", r.token, secret=True)
        _put(db, "meet_rk_host_preset", r.host_preset)
        _put(db, "meet_rk_guest_preset", r.guest_preset)
    db.commit()
    return admin_view(db)


@router.post("/admin/meet/test")
async def admin_test(admin=Depends(must_admin), db=Depends(get_db)):
    c = cfg(db)
    p = PROVIDERS[c["provider"]]
    if p.problem(c):
        raise HTTPException(422, p.problem(c))
    return await p.test(db)


# ---------------------------------------------------------------- mesh signalling (WebSocket)

@dataclass
class Peer:
    id: str
    ws: WebSocket
    name: str
    host: bool
    user_id: str | None
    audio: bool = False
    video: bool = False
    screen: bool = False
    chat_hits: list = field(default_factory=list)

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "host": self.host, "audio": self.audio, "video": self.video, "screen": self.screen}


@dataclass
class Room:
    code: str
    peers: dict[str, Peer] = field(default_factory=dict)
    history: list[dict] = field(default_factory=list)


rooms: dict[str, Room] = {}
MAX_SIGNAL = 24_000   # a session description is a few KB


async def send(peer: Peer, msg: dict) -> None:
    try:
        await peer.ws.send_text(json.dumps(msg, separators=(",", ":")))
    except Exception:
        pass


async def broadcast(room: Room, msg: dict, exclude: str | None = None) -> None:
    await asyncio.gather(*(send(p, msg) for p in list(room.peers.values()) if p.id != exclude))


async def close_room(code: str, msg: dict) -> None:
    room = rooms.get(code)
    if not room:
        return
    await broadcast(room, msg)
    for p in list(room.peers.values()):
        try:
            await p.ws.close(code=4410)
        except Exception:
            pass


def clean_name(s: str) -> str:
    return " ".join((s or "").split())[:60] or "Guest"


@ws_router.websocket("/ws/meet/{code}")
async def ws_meet(ws: WebSocket, code: str):
    token = ws.query_params.get("token")
    guest_name = ws.query_params.get("name", "")
    code = norm_code(code)

    def authorize():
        with connect() as db:
            m = db.execute("SELECT * FROM meetings WHERE code = ?", (code,)).fetchone()
            if not m or m["ended_at"] or m["provider"] != "mesh":
                return None
            c = cfg(db)
            if not c["enabled"]:
                return None
            user = access.get_user(db, token)
            if not user and not (m["guests"] and c["guests"] and guest_name.strip()):
                return None
            return {"user_id": user["id"] if user else None, "name": user["name"] if user else clean_name(guest_name), "host": bool(user and user["id"] == m["host_id"])}

    who = await asyncio.to_thread(authorize)
    if not who:
        await ws.accept()
        await ws.close(code=4403)
        return
    await ws.accept()
    room = rooms.setdefault(code, Room(code))
    if len(room.peers) >= MESH_MAX:
        await ws.send_text(json.dumps({"t": "full", "max": MESH_MAX}))
        await ws.close(code=4409)
        return
    me = Peer(secrets.token_hex(6), ws, who["name"], who["host"], who["user_id"])
    existing = [p.public() for p in room.peers.values()]
    room.peers[me.id] = me
    await send(me, {"t": "welcome", "id": me.id, "host": me.host, "peers": existing, "chat": room.history[-HISTORY:], "max": MESH_MAX})
    await broadcast(room, {"t": "joined", "peer": me.public()}, exclude=me.id)
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > MAX_SIGNAL:
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            t = msg.get("t")
            if t == "signal":
                target = room.peers.get(str(msg.get("to")))
                if target and target.id != me.id and isinstance(msg.get("data"), dict):
                    await send(target, {"t": "signal", "from": me.id, "data": msg["data"]})
            elif t == "state":
                me.audio, me.video, me.screen = bool(msg.get("audio")), bool(msg.get("video")), bool(msg.get("screen"))
                await broadcast(room, {"t": "state", "id": me.id, "audio": me.audio, "video": me.video, "screen": me.screen}, exclude=me.id)
            elif t == "chat":
                text = str(msg.get("text", "")).strip()[:CHAT_MAX]
                now = time.time()
                me.chat_hits = [h for h in me.chat_hits if now - h < 5]
                if not text or len(me.chat_hits) >= 8:
                    continue
                me.chat_hits.append(now)
                entry = {"t": "chat", "id": secrets.token_hex(5), "from": me.id, "name": me.name, "text": text, "ts": int(now * 1000)}
                room.history = [*room.history[-(HISTORY - 1):], entry]
                await broadcast(room, entry)
            elif t in ("mute", "kick") and me.host:
                target = room.peers.get(str(msg.get("to")))
                if target and target.id != me.id:
                    if t == "mute":
                        await send(target, {"t": "mute"})
                    else:
                        await send(target, {"t": "kicked"})
                        try:
                            await target.ws.close(code=4411)
                        except Exception:
                            pass
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        room.peers.pop(me.id, None)
        await broadcast(room, {"t": "left", "id": me.id})
        if not room.peers:
            rooms.pop(code, None)
