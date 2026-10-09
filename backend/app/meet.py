"""Video and voice meetings: rooms, settings, tickets and the providers that carry the audio and video.

A meeting is a room with a link (/m/<code>) and a host. It is either one-off (it ends when the host ends it, or after a week of nobody using it) or
permanent (it stays on the host's account with its code and settings; "ending" it only closes the session that is running, and the next person to
arrive starts a new one).

Everything that is not audio or video (the waiting room, reactions, raised hands, polls, co-hosts, spotlight, chat, captions) goes through one control
WebSocket per person (meetroom.py), for every provider. What carries the audio and video is a *provider*, chosen by the administrator and remembered on
each meeting, so switching later never breaks a meeting that is already running:

  mesh         Browsers connect to each other directly (WebRTC). This server only introduces them and hands out STUN/TURN servers, so no media passes
               through it. Cloudflare's free TURN service (or any TURN server) relays for people behind strict networks. Up to 8 people; costs nothing.
  realtimekit  Cloudflare RealtimeKit: this server creates the meeting and a token per person through Cloudflare's REST API; their SDK in the browser
               does the rest. Bigger rooms; billed by Cloudflare per participant-minute.

Joining is two steps so that approval can't be skipped: a *ticket* (a short-lived signed token, issued after the meeting's checks such as the passcode)
opens the control socket, where the host's waiting room decides; only once admitted does the person ask for *media credentials* (/media), which this
server hands out only to people who are in the room. A new provider is one class here (`creds`, `end`, `problem`, `test`) plus one adapter in
frontend/src/meet/. Calls are not end-to-end encrypted, and the meeting page says so.
"""
import json
import os
import secrets
import time

import httpx
import jwt
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from typing import Literal

from . import access, stt
from .db import get_db, settings_get, settings_set
from .routes import must_admin, must_user, current_user
from .security import ALGO, SECRET, RateLimiter, decrypt_secret, encrypt_secret

router = APIRouter(prefix="/api")
create_limiter = RateLimiter(30, 3600)
join_limiter = RateLimiter(60, 60)
caption_limiter = RateLimiter(40, 60)

CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"   # no look-alikes (i l o 0 1)
MESH_MAX = 8
RTK_MAX = 100
MAX_PERMANENT = 25
ONE_OFF_TTL = 7 * 86400    # a one-off meeting nobody has used for a week expires; make it permanent to keep it
TICKET_HOURS = 6
CF_API = os.environ.get("KOKO_CF_API", "https://api.cloudflare.com/client/v4")          # overridable so tests can use a mock
TURN_API = os.environ.get("KOKO_TURN_API", "https://rtc.live.cloudflare.com/v1/turn/keys")
STUN_DEFAULT = "stun:stun.cloudflare.com:3478"


def new_code() -> str:
    c = "".join(secrets.choice(CODE_ALPHABET) for _ in range(10))
    return f"{c[:3]}-{c[3:7]}-{c[7:]}"


def norm_code(code: str) -> str:
    return (code or "").strip().lower()


# ---------------------------------------------------------------- the administrator's settings

def _secret(db, key: str) -> str:
    raw = settings_get(db, key)
    return (decrypt_secret(raw) or "") if raw else ""


def cfg(db) -> dict:
    """Everything the administrator can set, with environment fallbacks (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, KOKO_RTK_APP_ID, ...)."""
    prov = settings_get(db, "meet_provider", "mesh")
    return {
        "enabled": settings_get(db, "meet_enabled", "1") == "1",
        "guests": settings_get(db, "meet_guests", "1") == "1",
        "provider": prov if prov in PROVIDERS else "mesh",
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
    cap = MESH_MAX

    @staticmethod
    def problem(c) -> str | None:
        if c["turn_mode"] == "cloudflare" and not (c["turn_key_id"] and c["turn_token"]):
            return "Relay servers are set to Cloudflare but the TURN key id or token is missing."
        return None

    @staticmethod
    async def creds(db, m, name: str, cid: str, manager: bool) -> dict:
        return {"provider": "mesh", "ice_servers": await ice_servers(cfg(db)), "max": MESH_MAX}

    @staticmethod
    async def end(db, m) -> None:
        return None

    @staticmethod
    async def test(db) -> dict:
        servers = await ice_servers(cfg(db))
        turn = any(any(str(u).startswith(("turn:", "turns:")) for u in s["urls"]) for s in servers)
        return {"ok": True, "message": ("Relay servers are working." if turn else "Works, with STUN only. People on strict networks (some offices, mobile networks) may not connect without a TURN relay."), "turn": turn}


class RealtimeKit:
    id = "realtimekit"
    label = "Cloudflare RealtimeKit"
    cap = RTK_MAX

    @staticmethod
    def problem(c) -> str | None:
        if not (c["rk_account"] and c["rk_app"] and c["rk_token"]):
            return "RealtimeKit needs the account id, app id and API token (Admin → Meetings)."
        return None

    @staticmethod
    async def _req(c, method: str, path: str, body: dict | None = None) -> dict:
        url = f"{CF_API}/accounts/{c['rk_account']}/realtime/kit/{c['rk_app']}{path}"
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as h:
                r = await h.request(method, url, json=body, headers={"Authorization": f"Bearer {c['rk_token']}"})
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
    async def creds(db, m, name: str, cid: str, manager: bool) -> dict:
        c = cfg(db)
        ref = m["provider_ref"]
        if not ref:
            data = await RealtimeKit._req(c, "POST", "/meetings", {"title": (m["title"] or "Meeting")[:100]})
            ref = str(data.get("id") or "")
            if not ref:
                raise HTTPException(502, "Cloudflare did not return a meeting id")
            db.execute("UPDATE meetings SET provider_ref = ? WHERE code = ? AND provider_ref = ''", (ref, m["code"]))
            db.commit()
            ref = db.execute("SELECT provider_ref FROM meetings WHERE code = ?", (m["code"],)).fetchone()["provider_ref"]   # two people arriving first: the first one's wins
        data = await RealtimeKit._req(c, "POST", f"/meetings/{ref}/participants", {
            "name": name[:60], "preset_name": c["rk_host"] if manager else c["rk_guest"], "custom_participant_id": cid})
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
            db.execute("UPDATE meetings SET provider_ref = '' WHERE code = ?", (m["code"],))   # a permanent meeting starts a fresh one next time
            db.commit()

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


# ---------------------------------------------------------------- one meeting's settings

DEFAULTS = {
    "approval": False,        # the host (or a co-host) must let each person in
    "host_first": False,      # people wait until the host or a co-host is in
    "guests": True,           # people without an account may join
    "mute_on_entry": False,   # people join with the microphone off
    "cam_off_on_entry": False,
    "chat": "all",            # who can write in the chat: all | host | off
    "share": "all",           # who can share their screen: all | host
    "reactions": True,
    "unmute": True,           # people may unmute themselves
    "captions": True,         # live captions can be switched on (when the server can transcribe speech)
    "max": 0,                 # most people at once; 0 = as many as the provider allows
}


class SettingsIn(BaseModel):
    approval: bool | None = None
    host_first: bool | None = None
    guests: bool | None = None
    mute_on_entry: bool | None = None
    cam_off_on_entry: bool | None = None
    chat: Literal["all", "host", "off"] | None = None
    share: Literal["all", "host"] | None = None
    reactions: bool | None = None
    unmute: bool | None = None
    captions: bool | None = None
    max: int | None = Field(None, ge=0, le=RTK_MAX)


def load_settings(m) -> dict:
    try:
        stored = json.loads(m["settings"] or "{}")
    except ValueError:
        stored = {}
    out = {**DEFAULTS, **{k: v for k, v in stored.items() if k in DEFAULTS}}
    out["guests"] = bool(m["guests"])
    return out


def passcode_of(m) -> str:
    return (decrypt_secret(m["passcode_enc"]) or "") if m["passcode_enc"] else ""


def expired(m) -> bool:
    return not m["permanent"] and time.time() - (m["last_used"] or m["created_at"]) > ONE_OFF_TTL


def closed(m) -> bool:
    return bool(m["ended_at"]) or expired(m)


def _room():
    from . import meetroom
    return meetroom


def public_info(db, m, user) -> dict:
    host = db.execute("SELECT name FROM users WHERE id = ?", (m["host_id"],)).fetchone()
    s = load_settings(m)
    return {"code": m["code"], "title": m["title"], "host_name": host["name"] if host else "", "is_host": bool(user and user["id"] == m["host_id"]),
            "ended": closed(m), "permanent": bool(m["permanent"]), "guests": s["guests"], "has_passcode": bool(m["passcode_enc"]), "approval": s["approval"],
            "provider": m["provider"], "created_at": m["created_at"], "live": _room().live_count(m["code"])}


def full_info(db, m, user) -> dict:
    """What the host sees and edits (the settings and the passcode)."""
    return {**public_info(db, m, user), "settings": load_settings(m), "passcode": passcode_of(m)}


def get_meeting(db, code: str):
    m = db.execute("SELECT * FROM meetings WHERE code = ?", (norm_code(code),)).fetchone()
    if not m:
        raise HTTPException(404, "That meeting doesn't exist. Check the link or code.")
    return m


def owner_or_admin(m, user) -> bool:
    return bool(user and (m["host_id"] == user["id"] or access.is_admin(user)))


# ---------------------------------------------------------------- tickets (who you are in a meeting, signed by this server)

def make_ticket(code: str, cid: str, name: str, uid: str | None) -> str:
    return jwt.encode({"typ": "meet", "c": code, "i": cid, "n": name, "u": uid or "", "exp": time.time() + TICKET_HOURS * 3600}, SECRET, ALGO)


def read_ticket(ticket: str | None, code: str) -> dict | None:
    if not ticket:
        return None
    try:
        p = jwt.decode(ticket, SECRET, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None
    return p if p.get("typ") == "meet" and p.get("c") == norm_code(code) else None


# ---------------------------------------------------------------- REST: starting, finding, joining

@router.get("/meet/config")
def public_config(db=Depends(get_db)):
    c = cfg(db)
    return {"enabled": c["enabled"], "guests": c["guests"], "captions": bool(stt.status(db).get("available"))}


class NewMeeting(BaseModel):
    title: str = Field("", max_length=100)
    permanent: bool = False
    passcode: str = Field("", max_length=32)
    settings: SettingsIn = SettingsIn()


def _check_passcode(p: str):
    if p and not (4 <= len(p) <= 32):
        raise HTTPException(422, "A passcode is 4 to 32 characters")


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
    if body.permanent and db.execute("SELECT COUNT(*) AS n FROM meetings WHERE host_id = ? AND permanent = 1", (user["id"],)).fetchone()["n"] >= MAX_PERMANENT:
        raise HTTPException(409, f"You can keep up to {MAX_PERMANENT} permanent meetings. Delete one first.")
    _check_passcode(body.passcode)
    s = body.settings.model_dump(exclude_none=True)
    guests = 1 if (s.pop("guests", True) and c["guests"]) else 0
    code = new_code()
    title = body.title.strip() or f"{user['name']}'s meeting"
    now = time.time()
    db.execute("INSERT INTO meetings (code, title, host_id, provider, guests, created_at, permanent, settings, passcode_enc, last_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
               (code, title, user["id"], c["provider"], guests, now, 1 if body.permanent else 0, json.dumps(s), encrypt_secret(body.passcode) if body.passcode else "", now))
    db.commit()
    return full_info(db, get_meeting(db, code), user)


@router.get("/meet")
def my_meetings(user=Depends(must_user), db=Depends(get_db)):
    rows = db.execute("SELECT * FROM meetings WHERE host_id = ? AND ended_at IS NULL ORDER BY permanent DESC, created_at DESC LIMIT 100", (user["id"],)).fetchall()
    return [full_info(db, m, user) for m in rows if not expired(m)]


@router.get("/meet/{code}")
def meeting_info(code: str, user=Depends(current_user), db=Depends(get_db)):
    c = cfg(db)
    if not c["enabled"]:
        raise HTTPException(403, "Meetings are turned off on this server")
    m = get_meeting(db, code)
    i = public_info(db, m, user)
    return {**i, "signed_in": bool(user), "can_join": bool(user) or (i["guests"] and c["guests"])}


class EditMeeting(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=100)
    permanent: bool | None = None
    passcode: str | None = Field(None, max_length=32)     # "" removes it
    settings: SettingsIn | None = None


@router.put("/meet/{code}")
async def edit_meeting(code: str, body: EditMeeting, user=Depends(must_user), db=Depends(get_db)):
    m = get_meeting(db, code)
    if not owner_or_admin(m, user):
        raise HTTPException(403, "Only the host can change this meeting")
    if closed(m):
        raise HTTPException(410, "This meeting has ended.")
    if body.title is not None:
        db.execute("UPDATE meetings SET title = ? WHERE code = ?", (body.title.strip(), m["code"]))
    if body.permanent is not None and bool(body.permanent) != bool(m["permanent"]):
        if body.permanent and db.execute("SELECT COUNT(*) AS n FROM meetings WHERE host_id = ? AND permanent = 1", (m["host_id"],)).fetchone()["n"] >= MAX_PERMANENT:
            raise HTTPException(409, f"You can keep up to {MAX_PERMANENT} permanent meetings.")
        db.execute("UPDATE meetings SET permanent = ?, last_used = ? WHERE code = ?", (1 if body.permanent else 0, time.time(), m["code"]))
    if body.passcode is not None:
        _check_passcode(body.passcode)
        db.execute("UPDATE meetings SET passcode_enc = ? WHERE code = ?", (encrypt_secret(body.passcode) if body.passcode else "", m["code"]))
    if body.settings is not None:
        patch = body.settings.model_dump(exclude_none=True)
        if "guests" in patch:
            db.execute("UPDATE meetings SET guests = ? WHERE code = ?", (1 if (patch.pop("guests") and cfg(db)["guests"]) else 0, m["code"]))
        merged = {k: v for k, v in load_settings(get_meeting(db, code)).items() if k != "guests"} | patch
        db.execute("UPDATE meetings SET settings = ? WHERE code = ?", (json.dumps(merged), m["code"]))
    db.commit()
    m = get_meeting(db, code)
    await _room().push_settings(m["code"], load_settings(m), m["title"])
    return full_info(db, m, user)


@router.delete("/meet/{code}")
async def delete_meeting(code: str, user=Depends(must_user), db=Depends(get_db)):
    m = get_meeting(db, code)
    if not owner_or_admin(m, user):
        raise HTTPException(403, "Only the host can delete this meeting")
    await _room().close_room(m["code"], {"t": "ended"})
    if m["provider"] in PROVIDERS:
        await PROVIDERS[m["provider"]].end(db, m)
    db.execute("DELETE FROM meetings WHERE code = ?", (m["code"],))
    db.commit()
    return {"ok": True}


class Join(BaseModel):
    name: str = Field("", max_length=60)
    passcode: str = Field("", max_length=64)


@router.post("/meet/{code}/join")
def join_meeting(code: str, body: Join, user=Depends(current_user), db=Depends(get_db)):
    """Check who may come in (guests, passcode) and hand back a ticket for the control socket. Admission itself is decided there."""
    c = cfg(db)
    if not c["enabled"]:
        raise HTTPException(403, "Meetings are turned off on this server")
    m = get_meeting(db, code)
    if closed(m):
        raise HTTPException(410, "This meeting has ended.")
    s = load_settings(m)
    if not user and not (s["guests"] and c["guests"]):
        raise HTTPException(401, {"code": "login_required", "message": "Sign in to join this meeting"})
    name = " ".join((user["name"] if user else body.name).split())[:60]
    if not name:
        raise HTTPException(422, "Enter your name")
    host = bool(user and user["id"] == m["host_id"])
    pc = passcode_of(m)
    if pc and not host and not secrets.compare_digest(body.passcode.strip().encode(), pc.encode()):
        raise HTTPException(403, {"code": "passcode", "message": "That passcode isn't right" if body.passcode else "This meeting needs a passcode"})
    if not join_limiter.allow(f"join:{user['id'] if user else 'guest'}"):
        raise HTTPException(429, "Too many people joining at once. Try again in a minute.")
    p = PROVIDERS.get(m["provider"])
    if not p or p.problem(c):
        raise HTTPException(409, f"This meeting was started with {p.label if p else m['provider']}, which isn't set up any more. Ask the host to start a new one.")
    cid = secrets.token_hex(8)
    return {"jt": make_ticket(m["code"], cid, name, user["id"] if user else None), "cid": cid, "name": name, "host": host, "title": m["title"],
            "provider": m["provider"], "permanent": bool(m["permanent"])}


class Media(BaseModel):
    jt: str = Field(max_length=2000)


@router.post("/meet/{code}/media")
async def meeting_media(code: str, body: Media, db=Depends(get_db)):
    """Audio and video credentials: only for people the room has let in."""
    t = read_ticket(body.jt, code)
    if not t:
        raise HTTPException(401, "Your place in the meeting expired. Join again.")
    m = get_meeting(db, code)
    if closed(m):
        raise HTTPException(410, "This meeting has ended.")
    state = _room().member(m["code"], t["i"])
    if state is None:
        raise HTTPException(403, "You're not in this meeting yet.")
    p = PROVIDERS[m["provider"]]
    return await p.creds(db, m, t["n"], t["i"], state["manager"])


@router.post("/meet/{code}/end")
async def end_meeting(code: str, user=Depends(must_user), db=Depends(get_db)):
    """End the session for everyone. A one-off meeting is over for good; a permanent one stays, ready for the next session."""
    m = get_meeting(db, code)
    if not owner_or_admin(m, user):
        raise HTTPException(403, "Only the host can end the meeting")
    if not m["permanent"] and not m["ended_at"]:
        db.execute("UPDATE meetings SET ended_at = ? WHERE code = ?", (time.time(), m["code"]))
        db.commit()
    if m["provider"] in PROVIDERS:
        await PROVIDERS[m["provider"]].end(db, m)
    await _room().close_room(m["code"], {"t": "ended", "permanent": bool(m["permanent"])})
    return {"ok": True, "permanent": bool(m["permanent"])}


@router.post("/meet/{code}/caption")
async def meeting_caption(code: str, jt: str = Form(...), language: str | None = Form(None), file: UploadFile = File(...), db=Depends(get_db)):
    """Turn a few seconds of one person's speech into a caption for everyone, using the server's speech-to-text."""
    t = read_ticket(jt, code)
    if not t or _room().member(norm_code(code), t["i"]) is None:
        raise HTTPException(403, "You're not in this meeting.")
    m = get_meeting(db, code)
    if not load_settings(m)["captions"]:
        raise HTTPException(403, "Captions are turned off for this meeting")
    if not caption_limiter.allow(f"cap:{t['i']}"):
        raise HTTPException(429, "Too many captions at once")
    audio = await file.read(stt.MAX_BYTES + 1)
    if len(audio) > stt.MAX_BYTES:
        raise HTTPException(413, "That recording is too long")
    try:
        text = (await stt.transcribe(audio, file.filename or "speech.wav", file.content_type or "audio/wav", language, db)).strip()
    except stt.STTError as e:
        raise HTTPException(503, str(e))
    if text:
        await _room().caption(norm_code(code), t["i"], text)
    return {"text": text}


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
