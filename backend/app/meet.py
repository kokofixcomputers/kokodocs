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
frontend/src/meet/. Audio and video are always encrypted by the browsers themselves (between them, or to Cloudflare's call servers for that provider), and the meeting page says which.
"""
import json
import os
import re
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
from .security import ALGO, SECRET, RateLimiter, decrypt_secret, encrypt_secret, make_meet_doc_token

router = APIRouter(prefix="/api")
create_limiter = RateLimiter(30, 3600)
join_limiter = RateLimiter(60, 60)
caption_limiter = RateLimiter(40, 60)

CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"   # no look-alikes (i l o 0 1)
MESH_MAX = 8
RTK_MAX = 100
SFU_MAX = 100
SFU_API = os.environ.get("KOKO_SFU_API", "https://rtc.live.cloudflare.com/v1")    # overridable so tests can use a mock
MAX_PERMANENT = 25
ONE_OFF_TTL = 7 * 86400    # a one-off meeting nobody has used for a week expires; make it permanent to keep it
TICKET_HOURS = 6
CF_API = os.environ.get("KOKO_CF_API", "https://api.cloudflare.com/client/v4")          # overridable so tests can use a mock
TURN_API = os.environ.get("KOKO_TURN_API", "https://rtc.live.cloudflare.com/v1/turn/keys")
STUN_DEFAULT = "stun:stun.cloudflare.com:3478"
try:   # a hardcoded test relay, if the (git-ignored) file is there
    from .turn_test import ICE as TEST_ICE
except ImportError:
    TEST_ICE = []
if os.environ.get("KOKO_NO_TEST_TURN"):
    TEST_ICE = []


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
        "sfu_app": settings_get(db, "meet_sfu_app") or os.environ.get("KOKO_SFU_APP_ID", ""),
        "sfu_secret": _secret(db, "meet_sfu_secret") or os.environ.get("KOKO_SFU_SECRET", ""),
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


ADDR = re.compile(r"^(?:(turns?|stuns?):)?(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+|localhost)(?::(\d{1,5}))?(\?transport=(?:udp|tcp))?$", re.I)
EXPLICIT = re.compile(r"^(turns?|stuns?):|:\d{1,5}(\?|$)", re.I)   # an address with a scheme or a port, as opposed to a word that happens to look like a host


def _scheme(addr: str) -> str:
    """A server address needs turn: or turns: in front, or the browser rejects the whole list. People type host:port, so add it (turns: for the usual TLS port 5349)."""
    if re.match(r"^(turns?|stuns?):", addr, re.I):
        return addr
    port = re.search(r":(\d+)(\?|$)", addr)
    return ("turns:" if port and port.group(1) == "5349" else "turn:") + addr


def parse_servers(text: str) -> tuple[list[dict], list[str]]:
    """One address per line. A line can carry its own login, `address username password` (for a service that has a different one), and several addresses can share
    a line. Returns the servers and anything that isn't an address (a browser refuses the whole list when one entry is invalid, so those are left out and reported)."""
    shared: list[str] = []
    own: list[dict] = []
    bad: list[str] = []
    for line in text.splitlines():
        tokens = [t for t in re.split(r"[\s,]+", line.strip()) if t]
        if not tokens:
            continue
        if not ADDR.match(tokens[0]):
            bad.append(tokens[0])
            continue
        addrs = [tokens[0]]
        rest = tokens[1:]
        while rest and EXPLICIT.search(rest[0]) and ADDR.match(rest[0]):
            addrs.append(rest.pop(0))
        urls = _usable([_scheme(x) for x in addrs])
        if len(rest) >= 2:
            own.append({"urls": urls, "username": rest[0], "credential": " ".join(rest[1:])})
        else:
            shared.extend(urls)
            bad.extend(rest)   # a single leftover word is neither an address nor a full login
    out: list[dict] = []
    return ([{"urls": shared}] if shared else []) + own, bad


def is_relay(sv: dict) -> bool:
    return any(str(u).lower().startswith(("turn:", "turns:")) for u in sv["urls"])


def custom_servers(c: dict) -> list[dict]:
    servers, _ = parse_servers(c["turn_urls"])
    for sv in servers:
        if "username" not in sv and c["turn_user"] and c["turn_pass"]:   # the lines without a login of their own share the username and password below the list
            sv.update(username=c["turn_user"], credential=c["turn_pass"])
    # a relay without a username and password makes the browser refuse to start any call at all, so such an entry is left out
    return [sv for sv in servers if not is_relay(sv) or (sv.get("username") and sv.get("credential"))]


def missing_login(c: dict) -> list[str]:
    """Relay addresses that have no username and password, from either their own line or the boxes below the list."""
    servers, _ = parse_servers(c["turn_urls"])
    return [u for sv in servers if is_relay(sv) and "username" not in sv and not (c["turn_user"] and c["turn_pass"]) for u in sv["urls"]]


async def ice_servers(c: dict) -> list[dict]:
    base = [{"urls": [STUN_DEFAULT]}, *TEST_ICE]
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
        return [*base, *custom_servers(c)]
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
        warn = relay_warning(cfg(db))
        if warn:
            return {"ok": True, "message": warn, "turn": turn}
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


# Cloudflare Realtime SFU: everyone sends ONE copy of their audio and video to Cloudflare, which forwards it to the others, so a 6 person call is 1 upload
# instead of 5. The browsers talk to Cloudflare's session API through this server (the app secret never leaves it); who is in which Cloudflare session is
# announced over the meeting's own control channel.
_sfu_sessions: dict[str, tuple[str, str, float]] = {}   # Cloudflare session id -> (meeting code, person, created)


def _sfu_prune() -> None:
    cut = time.time() - 12 * 3600
    for k in [k for k, v in _sfu_sessions.items() if v[2] < cut]:
        _sfu_sessions.pop(k, None)


class CloudflareSfu:
    id = "sfu"
    label = "Cloudflare SFU (one upload for everyone)"
    cap = SFU_MAX

    @staticmethod
    def problem(c) -> str | None:
        if not (c["sfu_app"] and c["sfu_secret"]):
            return "The Cloudflare SFU needs the app id and app secret (Admin → Meetings)."
        return None

    @staticmethod
    async def _req(c, method: str, path: str, body: dict | None = None) -> dict:
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=False) as h:
                r = await h.request(method, f"{SFU_API}/apps/{c['sfu_app']}{path}", json=body, headers={"Authorization": f"Bearer {c['sfu_secret']}"})
        except httpx.HTTPError as e:
            raise HTTPException(502, f"Could not reach Cloudflare ({type(e).__name__})")
        try:
            j = r.json()
        except ValueError:
            j = {}
        if r.status_code in (401, 403):
            raise HTTPException(502, "Cloudflare rejected the app secret. Check the app id and secret of the Realtime SFU app.")
        if r.status_code >= 400 or (isinstance(j, dict) and j.get("errorCode")):
            raise HTTPException(502, f"Cloudflare returned an error ({r.status_code}){': ' + str(j.get('errorDescription'))[:200] if isinstance(j, dict) and j.get('errorDescription') else ''}")
        return j if isinstance(j, dict) else {}

    @staticmethod
    async def creds(db, m, name: str, cid: str, manager: bool) -> dict:
        servers = await ice_servers(cfg(db))
        if not any("stun.cloudflare.com" in str(u) for s in servers for u in s["urls"]):
            servers = [{"urls": ["stun:stun.cloudflare.com:3478"]}, *servers]
        return {"provider": "sfu", "ice_servers": servers, "max": SFU_MAX}

    @staticmethod
    async def end(db, m) -> None:
        for k in [k for k, v in _sfu_sessions.items() if v[0] == m["code"]]:
            _sfu_sessions.pop(k, None)

    @staticmethod
    async def test(db) -> dict:
        d = await CloudflareSfu._req(cfg(db), "POST", "/sessions/new")
        if not d.get("sessionId"):
            raise HTTPException(502, "Cloudflare did not return a session id")
        return {"ok": True, "message": "Connected: a test session was created."}


PROVIDERS = {"mesh": Mesh, "realtimekit": RealtimeKit, "sfu": CloudflareSfu}


# ---------------------------------------------------------------- one meeting's settings

DEFAULTS = {
    "approval": False,        # the host (or a co-host) must let each person in
    "host_first": False,      # people wait until the host or a co-host is in
    "guests": False,          # people without an account may join (the host turns this on: it is off for a new meeting)
    "mute_on_entry": False,   # people join with the microphone off
    "cam_off_on_entry": False,
    "chat": "all",            # who can write in the chat: all | host | off
    "share": "all",           # who can share their screen: all | host
    "reactions": True,
    "unmute": True,           # people may unmute themselves
    "captions": True,         # live captions can be switched on (when the server can transcribe speech)
    "max": 0,                 # most people at once; 0 = as many as the provider allows
    "camera": True,           # people may turn their camera on
    "collab": "all",          # who may share a document to edit together: all | host
    "present": "all",         # who may present a presentation: all | host
    "edit_shared": True,      # people may edit a shared document (what a new share starts with)
    "seek": True,             # people may browse slides on their own while someone presents
    "recording": "host",      # who may record the meeting: off | host | managers
    "record_consent": False,  # everyone must agree to being recorded (those who don't are removed); otherwise people can decline and are left out of the recording
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
    camera: bool | None = None
    collab: Literal["all", "host"] | None = None
    present: Literal["all", "host"] | None = None
    edit_shared: bool | None = None
    seek: bool | None = None
    recording: Literal["off", "host", "managers"] | None = None
    record_consent: bool | None = None


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


MAX_COHOSTS = 10


def cohost_ids(m) -> list[str]:
    try:
        ids = json.loads(m["cohosts"] or "[]")
    except ValueError:
        ids = []
    return [i for i in ids if isinstance(i, str)]


def cohost_people(db, m) -> list[dict]:
    out = []
    for uid in cohost_ids(m):
        u = db.execute("SELECT id, name, email FROM users WHERE id = ?", (uid,)).fetchone()
        if u:
            out.append({"id": u["id"], "name": u["name"], "email": u["email"]})
    return out


def resolve_cohosts(db, emails: list[str], host_id: str) -> list[str]:
    """Account emails to account ids. Co-hosts must have an account (that is how they are recognised when they arrive)."""
    ids: list[str] = []
    missing = []
    for e in emails:
        e = (e or "").strip().lower()
        if not e:
            continue
        u = db.execute("SELECT id FROM users WHERE lower(email) = ? AND (disabled IS NULL OR disabled = 0)", (e,)).fetchone()
        if not u:
            missing.append(e)
        elif u["id"] != host_id and u["id"] not in ids:
            ids.append(u["id"])
    if missing:
        raise HTTPException(422, "No account with the email " + ", ".join(missing) + ". Co-hosts need a KokoDocs account.")
    if len(ids) > MAX_COHOSTS:
        raise HTTPException(422, f"A meeting can have up to {MAX_COHOSTS} pre-set co-hosts.")
    return ids


def _room():
    from . import meetroom
    return meetroom


def public_info(db, m, user) -> dict:
    host = db.execute("SELECT name FROM users WHERE id = ?", (m["host_id"],)).fetchone()
    s = load_settings(m)
    return {"code": m["code"], "title": m["title"], "host_name": host["name"] if host else "", "is_host": bool(user and user["id"] == m["host_id"]),
            "ended": closed(m), "permanent": bool(m["permanent"]), "guests": s["guests"], "has_passcode": bool(m["passcode_enc"]), "approval": s["approval"],
            "is_cohost": bool(user and user["id"] in cohost_ids(m)), "provider": m["provider"], "created_at": m["created_at"], "live": _room().live_count(m["code"]),
            "recording": _room().recording_public(m["code"])}


def full_info(db, m, user) -> dict:
    """What the host sees and edits (the settings and the passcode)."""
    return {**public_info(db, m, user), "settings": load_settings(m), "passcode": passcode_of(m), "cohosts": cohost_people(db, m), "role": "host"}


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
    cohosts: list[str] = Field(default_factory=list, max_length=20)   # account emails


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
    cohosts = resolve_cohosts(db, body.cohosts, user["id"])
    s = body.settings.model_dump(exclude_none=True)
    guests = 1 if (s.pop("guests", False) and c["guests"]) else 0
    code = new_code()
    title = body.title.strip() or f"{user['name']}'s meeting"
    now = time.time()
    db.execute("INSERT INTO meetings (code, title, host_id, provider, guests, created_at, permanent, settings, passcode_enc, last_used, cohosts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
               (code, title, user["id"], c["provider"], guests, now, 1 if body.permanent else 0, json.dumps(s), encrypt_secret(body.passcode) if body.passcode else "", now, json.dumps(cohosts)))
    db.commit()
    return full_info(db, get_meeting(db, code), user)


@router.get("/meet")
def my_meetings(user=Depends(must_user), db=Depends(get_db)):
    rows = db.execute("SELECT * FROM meetings WHERE host_id = ? AND ended_at IS NULL ORDER BY permanent DESC, created_at DESC LIMIT 100", (user["id"],)).fetchall()
    out = [full_info(db, m, user) for m in rows if not expired(m)]
    # meetings someone made you a co-host of: you can start them, let people in and share the invite, but not change them
    for m in db.execute("SELECT * FROM meetings WHERE ended_at IS NULL AND host_id != ? AND cohosts LIKE ? ORDER BY created_at DESC LIMIT 100", (user["id"], f'%"{user["id"]}"%')).fetchall():
        if user["id"] in cohost_ids(m) and not expired(m):
            out.append({**public_info(db, m, user), "passcode": passcode_of(m), "role": "cohost"})
    return out


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
    cohosts: list[str] | None = Field(None, max_length=20)   # account emails; replaces the list


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
    if body.cohosts is not None:
        db.execute("UPDATE meetings SET cohosts = ? WHERE code = ?", (json.dumps(resolve_cohosts(db, body.cohosts, m["host_id"])), m["code"]))
    db.commit()
    m = get_meeting(db, code)
    await _room().push_settings(m["code"], load_settings(m), m["title"], cohost_ids(m))
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
    cohost = bool(user and user["id"] in cohost_ids(m))
    pc = passcode_of(m)
    if pc and not (host or cohost) and not secrets.compare_digest(body.passcode.strip().encode(), pc.encode()):
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


class SfuCall(BaseModel):
    jt: str = Field(max_length=2000)
    body: dict = Field(default_factory=dict)


def _sfu_member(db, code: str, jt: str):
    t = read_ticket(jt, code)
    if not t:
        raise HTTPException(401, "Your place in the meeting expired. Join again.")
    m = get_meeting(db, code)
    if closed(m):
        raise HTTPException(410, "This meeting has ended.")
    if m["provider"] != "sfu":
        raise HTTPException(409, "This meeting doesn't use the Cloudflare SFU.")
    if _room().member(m["code"], t["i"]) is None:
        raise HTTPException(403, "You're not in this meeting yet.")
    return m, t


@router.post("/meet/{code}/sfu/session")
async def sfu_session(code: str, body: SfuCall, db=Depends(get_db)):
    """Start this person's Cloudflare session (where their audio and video are sent)."""
    m, t = _sfu_member(db, code, body.jt)
    _sfu_prune()
    d = await CloudflareSfu._req(cfg(db), "POST", "/sessions/new")
    sid = str(d.get("sessionId") or "")
    if not sid:
        raise HTTPException(502, "Cloudflare did not return a session id")
    _sfu_sessions[sid] = (m["code"], t["i"], time.time())
    return {"sessionId": sid}


@router.post("/meet/{code}/sfu/{sid}/tracks")
async def sfu_tracks(code: str, sid: str, body: SfuCall, db=Depends(get_db)):
    """Send tracks (an offer with local tracks) or fetch other people's (remote tracks, which must belong to this meeting)."""
    m, t = _sfu_member(db, code, body.jt)
    own = _sfu_sessions.get(sid)
    if not own or own[0] != m["code"] or own[1] != t["i"]:
        raise HTTPException(403, "That isn't your session.")
    for tr in (body.body.get("tracks") or []):
        if isinstance(tr, dict) and tr.get("location") == "remote":
            other = _sfu_sessions.get(str(tr.get("sessionId")))
            if not other or other[0] != m["code"]:
                raise HTTPException(403, "That session isn't in this meeting.")
    return await CloudflareSfu._req(cfg(db), "POST", f"/sessions/{sid}/tracks/new", body.body)


@router.put("/meet/{code}/sfu/{sid}/renegotiate")
async def sfu_renegotiate(code: str, sid: str, body: SfuCall, db=Depends(get_db)):
    m, t = _sfu_member(db, code, body.jt)
    own = _sfu_sessions.get(sid)
    if not own or own[0] != m["code"] or own[1] != t["i"]:
        raise HTTPException(403, "That isn't your session.")
    return await CloudflareSfu._req(cfg(db), "PUT", f"/sessions/{sid}/renegotiate", body.body)


@router.post("/meet/{code}/share/token")
async def share_token(code: str, body: Media, db=Depends(get_db)):
    """A key to open the document being shared in the meeting: editor if people may edit it (and this person may), otherwise viewer."""
    code = norm_code(code)
    t = read_ticket(body.jt, code)
    room = _room().rooms.get(code)
    me = next((p for p in room.peers.values() if p.cid == t["i"]), None) if (t and room) else None
    if not me:
        raise HTTPException(403, "You're not in this meeting.")
    sh = room.share
    if not sh:
        raise HTTPException(404, "Nothing is being shared right now.")
    perms = _room().effective(room, me)
    role = "editor" if sh["kind"] == "collab" and sh["edit"] and perms["edit"] else "viewer"
    return {"doc_id": sh["doc_id"], "token": make_meet_doc_token(sh["doc_id"], role, code), "role": role, "kind": sh["kind"], "doc_kind": sh["doc_kind"]}


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

def relay_warning(c: dict) -> str | None:
    """Not a reason to stop meetings (the entries without a login are simply left out) but something the administrator should fix."""
    miss = missing_login(c) if c["turn_mode"] == "custom" else []
    if miss:
        return f"{', '.join(x.split(':', 1)[1] for x in miss[:3])} has no username and password, so it is being ignored. Put them after the address on the same line (address username password), or in the Username and Password boxes."
    _, bad = parse_servers(c["turn_urls"]) if c["turn_mode"] == "custom" else ([], [])
    return ("These aren't server addresses and are ignored: " + ", ".join(f'"{x}"' for x in bad[:4])) if bad else None


def admin_view(db) -> dict:
    c = cfg(db)
    return {"warning": relay_warning(c), "enabled": c["enabled"], "guests": c["guests"], "provider": c["provider"],
            "providers": [{"id": p.id, "label": p.label} for p in PROVIDERS.values()],
            "turn": {"mode": c["turn_mode"], "key_id": c["turn_key_id"], "token_set": bool(c["turn_token"]), "urls": c["turn_urls"], "user": c["turn_user"], "pass_set": bool(c["turn_pass"])},
            "rtk": {"account": c["rk_account"], "app": c["rk_app"], "token_set": bool(c["rk_token"]), "host_preset": c["rk_host"], "guest_preset": c["rk_guest"]},
            "sfu": {"app": c["sfu_app"], "secret_set": bool(c["sfu_secret"])},
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


class SfuIn(BaseModel):
    app: str | None = Field(None, max_length=80)
    secret: str | None = Field(None, max_length=500)    # None or "" keeps the stored one


class AdminIn(BaseModel):
    enabled: bool | None = None
    guests: bool | None = None
    provider: str | None = None
    turn: TurnIn | None = None
    rtk: RtkIn | None = None
    sfu: SfuIn | None = None


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
    if t and t.urls is not None:
        _, bad = parse_servers(t.urls)
        if bad:
            raise HTTPException(422, "These aren't server addresses: " + ", ".join(f'"{x}"' for x in bad[:6]) + ". Write one address per line, like free.expressturn.com:3478. A login goes after the address on the same line (address username password), or in the Username and Password boxes below.")
    if t and (t.urls is not None or t.user is not None or t.password is not None) and (t.mode or settings_get(db, "meet_turn_mode", "none")) == "custom":
        now = {"turn_urls": t.urls if t.urls is not None else settings_get(db, "meet_turn_urls"), "turn_user": (t.user if t.user is not None else settings_get(db, "meet_turn_user")).strip(),
               "turn_pass": t.password.strip() if t.password and t.password.strip() else _secret(db, "meet_turn_pass")}
        miss = missing_login(now)
        if miss:
            raise HTTPException(422, f"{', '.join(x.split(':', 1)[1] for x in miss[:3])} needs a username and password: put them after the address on the same line (address username password), or in the Username and Password boxes below.")
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
    f = body.sfu
    if f:
        _put(db, "meet_sfu_app", f.app)
        _put(db, "meet_sfu_secret", f.secret, secret=True)
    db.commit()
    return admin_view(db)


@router.post("/admin/meet/test")
async def admin_test(admin=Depends(must_admin), db=Depends(get_db)):
    c = cfg(db)
    p = PROVIDERS[c["provider"]]
    if p.problem(c):
        raise HTTPException(422, p.problem(c))
    return await p.test(db)
