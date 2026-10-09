"""The control socket of a meeting: one WebSocket per person, for every audio/video provider.

It carries everything that is not audio or video: who is here, the waiting room, the signalling the direct provider needs, chat (public and private),
reactions, raised hands, polls, co-hosts, spotlight, lock, "mute everyone", and captions. Rooms live in memory only for as long as someone is in them:
nothing said in a meeting (chat, polls, captions) is stored.

Who may do what: the *host* is the account that owns the meeting; the host can make anyone a *co-host* for this session. Both are *managers*: they can
let people in from the waiting room, mute, remove, spotlight, lock the room, lower hands and run polls. Only the host changes the meeting's settings or
makes co-hosts. Settings that are about people's own devices (muted on entry, unmuting yourself, who may share a screen) are enforced here for what the
server can see (what is shown, what is relayed) and by every honest client for the rest: audio and video travel between browsers (or through the
provider), not through this server, so a modified browser could still send them.
"""
import asyncio
import json
import os
import secrets
import time
from dataclasses import dataclass, field

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from . import access
from .db import connect
from .meet import MESH_MAX, PROVIDERS, RTK_MAX, cfg, closed, cohost_ids, load_settings, norm_code, read_ticket

ws_router = APIRouter()

CHAT_MAX = 2000
HISTORY = 80
MAX_SIGNAL = 24_000          # a session description is a few KB
EMOJIS = ["👍", "👏", "❤️", "😂", "😮", "🎉", "🙏", "🔥"]
MAX_POLLS = 20
SHARE_GRACE = float(os.environ.get("KOKO_SHARE_GRACE", "8"))   # seconds the person sharing a document may be gone before the share ends
PERM_KEYS = ("mic", "camera", "screen", "chat", "react", "collab", "present", "edit", "seek")
SHARE_KINDS = ("doc", "sheet", "slides")
CONSENT_GRACE = float(os.environ.get("KOKO_CONSENT_GRACE", "60"))     # seconds someone may take to answer when everyone must agree to a recording
RECORDER_GRACE = float(os.environ.get("KOKO_RECORDER_GRACE", "20"))   # seconds the recording browser may be gone before the recording ends


@dataclass
class Peer:
    id: str
    cid: str
    ws: WebSocket
    name: str
    uid: str | None
    owner: bool
    gid: str = ""
    cohost: bool = False
    audio: bool = False
    video: bool = False
    screen: bool = False
    waiting: str = ""            # "" once in the room; otherwise why they wait: approval | host
    chat_hits: list = field(default_factory=list)
    react_hits: list = field(default_factory=list)
    caption_hits: list = field(default_factory=list)

    @property
    def manager(self) -> bool:
        return self.owner or self.cohost

    @property
    def guest(self) -> bool:
        return self.uid is None

    @property
    def key(self) -> str:
        return self.uid or self.cid


@dataclass
class Poll:
    id: str
    q: str
    options: list[str]
    multi: bool
    anonymous: bool
    open: bool = True
    votes: dict = field(default_factory=dict)   # voter key -> {"name": str, "choices": [int]}


@dataclass
class Room:
    code: str
    provider: str = "mesh"
    settings: dict = field(default_factory=dict)
    title: str = ""
    host_id: str = ""
    peers: dict[str, Peer] = field(default_factory=dict)
    waiting: dict[str, Peer] = field(default_factory=dict)
    admitted: set = field(default_factory=set)      # cids that have been let in (a reconnect doesn't wait again)
    blocked: set = field(default_factory=set)
    cohosts: set = field(default_factory=set)       # keys (account id or cid) made co-host this session
    fixed: set = field(default_factory=set)         # accounts the host set as co-hosts in the meeting's settings, before it started
    locked: bool = False
    captions_on: bool = False                       # live captions are running (every browser transcribes its own speech)
    spotlight: str | None = None
    hands: list = field(default_factory=list)       # peer ids, in the order hands went up
    polls: list[Poll] = field(default_factory=list)
    history: list = field(default_factory=list)
    recording: dict | None = None                   # {id, by, cid, since, required}: the meeting is being recorded
    overrides: dict = field(default_factory=dict)   # cid -> {permission: True/False}: what the host allowed or forbade one person, over the meeting's defaults
    share: dict | None = None                       # the document being edited together or presented: {id, kind, doc_id, title, doc_kind, by, cid, edit, seek, slide, since}
    consents: dict = field(default_factory=dict)    # cid -> True/False: who agreed to the recording that is running
    started: float = field(default_factory=time.time)

    def cap(self) -> int:
        pc = PROVIDERS[self.provider].cap
        m = int(self.settings.get("max") or 0)
        return min(m, pc) if m else pc


rooms: dict[str, Room] = {}


def live_count(code: str) -> int:
    r = rooms.get(code)
    return len(r.peers) if r else 0


def member(code: str, cid: str) -> dict | None:
    """Is this connection in the room (admitted, not waiting)? Used before handing out audio and video credentials."""
    r = rooms.get(code)
    if not r:
        return None
    for p in r.peers.values():
        if p.cid == cid:
            return {"manager": p.manager, "owner": p.owner}
    return None


def recording_public(code: str) -> dict | None:
    r = rooms.get(code)
    return {"required": bool(r.recording["required"])} if r and r.recording else None


# ---------------------------------------------------------------- sending

async def send(peer: Peer, msg: dict) -> None:
    try:
        await peer.ws.send_text(json.dumps(msg, separators=(",", ":")))
    except Exception:
        pass


async def broadcast(room: Room, msg: dict, exclude: str | None = None, managers_only: bool = False) -> None:
    targets = [p for p in room.peers.values() if p.id != exclude and (p.manager or not managers_only)]
    await asyncio.gather(*(send(p, msg) for p in targets))


def public(room: Room, p: Peer) -> dict:
    return {"id": p.id, "cid": p.cid, "name": p.name, "host": p.owner, "cohost": p.cohost, "guest": p.guest, "audio": p.audio, "video": p.video, "screen": p.screen}


def settings_view(room: Room) -> dict:
    rec = room.recording
    return {**room.settings, "locked": room.locked, "captions_on": room.captions_on and bool(room.settings.get("captions")),
            "recording_now": {"by": rec["by"], "since": int(rec["since"] * 1000), "required": rec["required"]} if rec else None}


def waiting_dicts(room: Room) -> list[dict]:
    return [{"id": w.id, "name": w.name, "reason": w.waiting, "guest": w.guest} for w in room.waiting.values()]


def poll_view(poll: Poll, viewer: Peer) -> dict:
    counts = [0] * len(poll.options)
    names: list[list[str]] = [[] for _ in poll.options]
    for v in poll.votes.values():
        for c in v["choices"]:
            counts[c] += 1
            names[c].append(v["name"])
    mine = poll.votes.get(viewer.key, {}).get("choices", [])
    out = {"id": poll.id, "q": poll.q, "options": poll.options, "multi": poll.multi, "anonymous": poll.anonymous, "open": poll.open,
           "counts": counts, "total": len(poll.votes), "mine": mine}
    if not poll.anonymous:
        out["names"] = names
    return out


async def send_polls(room: Room) -> None:
    await asyncio.gather(*(send(p, {"t": "polls", "polls": [poll_view(x, p) for x in room.polls]}) for p in room.peers.values()))


async def send_waiting(room: Room) -> None:
    await broadcast(room, {"t": "waiting-list", "list": waiting_dicts(room)}, managers_only=True)


async def send_hands(room: Room) -> None:
    await broadcast(room, {"t": "hands", "order": room.hands})


def implied_consent(room: Room, p: Peer) -> bool:
    """The person recording, and the host (whose storage it is), don't need to be asked."""
    return bool(room.recording and (p.cid == room.recording["cid"] or p.owner))


def consent_of(room: Room, p: Peer) -> str:
    if implied_consent(room, p):
        return "yes"
    v = room.consents.get(p.cid)
    return "pending" if v is None else ("yes" if v else "no")


async def send_consents(room: Room) -> None:
    """Tell the managers (the recorder is one) who is in the recording, who said no and who has not answered yet."""
    groups: dict[str, list[str]] = {"yes": [], "no": [], "pending": []}
    if room.recording:
        for p in room.peers.values():
            groups[consent_of(room, p)].append(p.id)
    await broadcast(room, {"t": "consents", **groups}, managers_only=True)


async def decline_removal(room: Room, p: Peer) -> None:
    await send(p, {"t": "declined"})
    await close_peer(p, 4415)


async def insist_on_consent(room: Room, p: Peer, delay: float | None = None) -> None:
    """When everyone must agree, someone who never answers is removed after a minute."""
    rec = room.recording
    if not rec or not rec["required"] or implied_consent(room, p) or room.consents.get(p.cid) is not None:
        return

    async def later():
        await asyncio.sleep(CONSENT_GRACE if delay is None else delay)
        if room.recording is rec and p.id in room.peers and room.consents.get(p.cid) is None and not implied_consent(room, p):
            await decline_removal(room, p)
    asyncio.create_task(later())


async def set_recording(code: str, info: dict | None) -> None:
    """A recording starts (everyone is asked to agree) or ends."""
    room = rooms.get(code)
    if not room:
        return
    room.recording = info
    room.consents.clear()
    await broadcast(room, {"t": "settings", "settings": settings_view(room), "title": room.title})
    await send_consents(room)
    if info:
        for p in list(room.peers.values()):
            await insist_on_consent(room, p)
    elif not room.peers and not room.waiting and rooms.get(code) is room:
        rooms.pop(code, None)


def effective(room: Room, p: Peer) -> dict:
    """What this person may do: everything for hosts and co-hosts; for everyone else the meeting's defaults, changed by whatever the host set for them."""
    if p.manager:
        return {k: True for k in PERM_KEYS}
    s = room.settings
    base = {"mic": bool(s.get("unmute", True)), "camera": bool(s.get("camera", True)), "screen": s.get("share", "all") == "all", "chat": s.get("chat", "all") == "all",
            "react": bool(s.get("reactions", True)), "collab": s.get("collab", "all") == "all", "present": s.get("present", "all") == "all",
            "edit": bool(s.get("edit_shared", True)), "seek": bool(s.get("seek", True))}
    base.update({k: bool(v) for k, v in room.overrides.get(p.cid, {}).items() if k in PERM_KEYS})
    if s.get("chat") == "off":
        base["chat"] = False
    return base


async def send_perms(room: Room, only: Peer | None = None) -> None:
    for p in ([only] if only else list(room.peers.values())):
        await send(p, {"t": "perms", "perms": effective(room, p)})


async def send_overrides(room: Room) -> None:
    by_cid = {p.cid: p.id for p in room.peers.values()}
    await broadcast(room, {"t": "overrides", "overrides": {by_cid[c]: o for c, o in room.overrides.items() if c in by_cid}}, managers_only=True)


async def enforce_now(room: Room, p: Peer) -> None:
    """Something was taken away from this person: switch it off if they are doing it right now."""
    perms = effective(room, p)
    forced = {}
    if p.audio and not perms["mic"]:
        forced["audio"] = False
    if p.video and not perms["camera"]:
        forced["video"] = False
    if p.screen and not perms["screen"]:
        forced["screen"] = False
    if forced:
        p.audio, p.video, p.screen = p.audio and "audio" not in forced, p.video and "video" not in forced, p.screen and "screen" not in forced
        await send(p, {"t": "force", **forced, "text": "The host changed what you can do in this meeting."})
        await broadcast(room, {"t": "state", "id": p.id, "audio": p.audio, "video": p.video, "screen": p.screen}, exclude=p.id)


def share_active(code: str, doc_id: str) -> bool:
    r = rooms.get(code)
    return bool(r and r.share and r.share["doc_id"] == doc_id)


def share_public(room: Room) -> dict | None:
    s = room.share
    if not s:
        return None
    by = next((p.id for p in room.peers.values() if p.cid == s["cid"]), "")
    return {"id": s["id"], "kind": s["kind"], "doc_id": s["doc_id"], "title": s["title"], "doc_kind": s["doc_kind"], "by": s["by"], "by_id": by, "edit": s["edit"], "seek": s["seek"], "slide": s["slide"], "since": int(s["since"] * 1000)}


async def set_share(room: Room, share: dict | None) -> None:
    room.share = share
    await broadcast(room, {"t": "share", "share": share_public(room)})
    if share is None and not room.peers and not room.waiting and not room.recording and rooms.get(room.code) is room:
        rooms.pop(room.code, None)


def managers_present(room: Room) -> bool:
    return any(p.manager for p in room.peers.values())


# ---------------------------------------------------------------- admission

async def admit(room: Room, p: Peer) -> bool:
    room.waiting.pop(p.id, None)
    if len(room.peers) >= room.cap():
        await send(p, {"t": "full", "max": room.cap()})
        try:
            await p.ws.close(code=4409)
        except Exception:
            pass
        return False
    p.waiting = ""
    room.admitted.add(p.cid)
    existing = [public(room, x) for x in room.peers.values()]
    room.peers[p.id] = p
    welcome = {"t": "welcome", "me": {"id": p.id, "cid": p.cid, "owner": p.owner, "cohost": p.cohost, "manager": p.manager}, "peers": existing,
               "chat": room.history[-HISTORY:], "settings": settings_view(room), "title": room.title, "spotlight": room.spotlight, "hands": room.hands,
               "started": int(room.started * 1000), "provider": room.provider, "emojis": EMOJIS, "consent": room.consents.get(p.cid), "perms": effective(room, p), "share": share_public(room),
               "polls": [poll_view(x, p) for x in room.polls]}
    if p.manager:
        welcome["waiting"] = waiting_dicts(room)
        welcome["overrides"] = {by.id: room.overrides[by.cid] for by in [*room.peers.values(), p] if by.cid in room.overrides}
    await send(p, welcome)
    await broadcast(room, {"t": "joined", "peer": public(room, p)}, exclude=p.id)
    if p.manager:
        await release_host_waiters(room)
    if room.recording:
        await send_consents(room)
        await insist_on_consent(room, p)
    return True


async def release_host_waiters(room: Room) -> None:
    """A manager has arrived: people who were waiting for the host come in, or (if the host also approves people) wait for approval."""
    for w in [x for x in room.waiting.values() if x.waiting == "host"]:
        if room.settings.get("approval"):
            w.waiting = "approval"
            await send(w, {"t": "waiting", "reason": "approval"})
        else:
            await admit(room, w)
    await send_waiting(room)


async def close_peer(p: Peer, code: int) -> None:
    try:
        await p.ws.close(code=code)
    except Exception:
        pass


async def close_room(code: str, msg: dict) -> None:
    room = rooms.get(code)
    if not room:
        return
    if room.recording:
        from . import recordings
        await recordings.finish(room.recording["id"], tell_room=False)
    room.share = None
    everyone = [*room.peers.values(), *room.waiting.values()]
    await asyncio.gather(*(send(p, msg) for p in everyone))
    for p in everyone:
        await close_peer(p, 4410)
    rooms.pop(code, None)


async def push_settings(code: str, settings: dict, title: str, fixed: list[str] | None = None) -> None:
    """The host changed the meeting's settings (from the manager page or the meeting itself): the room follows at once."""
    room = rooms.get(code)
    if not room:
        return
    was_approval = room.settings.get("approval")
    room.settings = {**settings}
    room.title = title
    if fixed is not None:   # the host changed who is a co-host in the settings: people already in the room are promoted or demoted
        room.fixed = set(fixed)
        for p in list(room.peers.values()):
            want = bool(p.uid and p.uid in room.fixed) or p.key in room.cohosts
            if not p.owner and want != p.cohost:
                p.cohost = want
                await broadcast(room, {"t": "cohost", "id": p.id, "on": want})
                await send(p, {"t": "role", "manager": p.manager, "cohost": want, "waiting": waiting_dicts(room) if want else []})
                await send_perms(room, p)
                if want:
                    await release_host_waiters(room)
    await broadcast(room, {"t": "settings", "settings": settings_view(room), "title": title})
    await send_perms(room)
    for p in list(room.peers.values()):
        await enforce_now(room, p)
    if was_approval and not settings.get("approval"):   # approval switched off: everyone waiting for it comes in
        for w in [x for x in room.waiting.values() if x.waiting == "approval"]:
            await admit(room, w)
        await send_waiting(room)


async def caption(code: str, cid: str, text: str) -> None:
    room = rooms.get(code)
    if not room or not room.settings.get("captions") or not room.captions_on:
        return
    who = next((p for p in room.peers.values() if p.cid == cid), None)
    if who:
        await broadcast(room, {"t": "caption", "from": who.id, "name": who.name, "text": text[:400], "ts": int(time.time() * 1000)})


# ---------------------------------------------------------------- the socket

def _authorize(code: str, ticket: str | None):
    t = read_ticket(ticket, code)
    if not t:
        return None
    with connect() as db:
        m = db.execute("SELECT * FROM meetings WHERE code = ?", (code,)).fetchone()
        if not m or closed(m):
            return None
        c = cfg(db)
        if not c["enabled"] or m["provider"] not in PROVIDERS:
            return None
        s = load_settings(m)
        uid = t["u"] or None
        if not uid and not (s["guests"] and c["guests"]):
            return None
        db.execute("UPDATE meetings SET last_used = ? WHERE code = ?", (time.time(), code))
        db.commit()
        return {"cid": t["i"], "name": t["n"], "uid": uid, "owner": bool(uid and uid == m["host_id"]), "provider": m["provider"], "settings": s, "title": m["title"], "host_id": m["host_id"], "fixed": cohost_ids(m)}


@ws_router.websocket("/ws/meet/{code}")
async def ws_meet(ws: WebSocket, code: str):
    code = norm_code(code)
    who = await asyncio.to_thread(_authorize, code, ws.query_params.get("jt"))
    await ws.accept()
    if not who:
        await ws.close(code=4403)
        return
    room = rooms.setdefault(code, Room(code, who["provider"], who["settings"], who["title"], who["host_id"]))
    room.fixed = set(who["fixed"])
    me = Peer(secrets.token_hex(6), who["cid"], ws, who["name"], who["uid"], who["owner"], gid=ws.query_params.get("gid", "")[:40])
    me.cohost = me.key in room.cohosts or bool(me.uid and me.uid in room.fixed)
    # the same person reconnecting: the old connection is replaced (and does not have to be approved again)
    for old in [x for x in [*room.peers.values(), *room.waiting.values()] if x.cid == me.cid]:
        await send(old, {"t": "replaced"})
        await close_peer(old, 4414)
    if me.key in room.blocked or (me.gid and me.gid in room.blocked):
        await send(me, {"t": "denied", "why": "removed"})
        await close_peer(me, 4412)
        return
    ok = True
    if not me.manager and me.cid not in room.admitted:
        if room.locked:
            await send(me, {"t": "locked"})
            await close_peer(me, 4413)
            return
        if room.settings.get("host_first") and not managers_present(room):
            me.waiting = "host"
        elif room.settings.get("approval"):
            me.waiting = "approval"
    if me.waiting:
        room.waiting[me.id] = me
        await send(me, {"t": "waiting", "reason": me.waiting, "id": me.id, "title": room.title})
        await send_waiting(room)
    else:
        ok = await admit(room, me)
    try:
        while ok:
            raw = await ws.receive_text()
            if len(raw) > MAX_SIGNAL:
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if isinstance(msg, dict):
                await handle(room, me, msg)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await leave(room, me)


async def leave(room: Room, me: Peer) -> None:
    was_waiting = room.waiting.pop(me.id, None) is not None
    present = room.peers.pop(me.id, None) is not None
    if me.id in room.hands:
        room.hands.remove(me.id)
    if room.spotlight == me.id:
        room.spotlight = None
        await broadcast(room, {"t": "spotlight", "id": None})
    if present:
        await broadcast(room, {"t": "left", "id": me.id})
        await send_hands(room)
    if was_waiting:
        await send_waiting(room)
    rec = room.recording
    if present and rec and rec["cid"] == me.cid:
        async def stop_if_gone():   # a dropped connection that comes back within a moment keeps recording
            await asyncio.sleep(RECORDER_GRACE)
            if room.recording is rec and not any(x.cid == rec["cid"] for x in room.peers.values()):
                from . import recordings
                await recordings.finish(rec["id"])
        asyncio.create_task(stop_if_gone())
    sh = room.share
    if present and sh and sh["cid"] == me.cid:
        async def stop_if_gone_share():   # the person sharing a document left: the share ends unless they come right back
            await asyncio.sleep(SHARE_GRACE)
            if room.share is sh and not any(x.cid == sh["cid"] for x in room.peers.values()):
                await set_share(room, None)
        asyncio.create_task(stop_if_gone_share())
    if present and rec:
        await send_consents(room)
    if not room.peers and not room.waiting and rooms.get(room.code) is room and not rec and not room.share:
        rooms.pop(room.code, None)


def _rate(hits: list, limit: int, window: float) -> bool:
    now = time.time()
    hits[:] = [h for h in hits if now - h < window]
    if len(hits) >= limit:
        return False
    hits.append(now)
    return True


async def handle(room: Room, me: Peer, msg: dict) -> None:
    t = msg.get("t")
    if me.waiting:
        return   # people in the waiting room can do nothing until they are let in
    st = room.settings

    if t == "signal":
        target = room.peers.get(str(msg.get("to")))
        if target and target.id != me.id and isinstance(msg.get("data"), dict):
            await send(target, {"t": "signal", "from": me.id, "data": msg["data"]})

    elif t == "state":
        perms = effective(room, me)
        audio, video, screen = bool(msg.get("audio")), bool(msg.get("video")), bool(msg.get("screen"))
        forced: dict = {}
        why = ""
        if audio and not perms["mic"]:
            audio = False; forced["audio"] = False; why = "You can't unmute yourself in this meeting. Raise your hand to ask."
        if video and not perms["camera"]:
            video = False; forced["video"] = False; why = "You can't turn your camera on in this meeting."
        if screen and (not perms["screen"] or room.share):
            screen = False; forced["screen"] = False
            why = "Only the host can share their screen in this meeting." if not perms["screen"] else "A document is being shared. Stop it first to share your screen."
        if forced:
            await send(me, {"t": "force", **forced, "text": why})
        me.audio, me.video, me.screen = audio, video, screen
        await broadcast(room, {"t": "state", "id": me.id, "audio": me.audio, "video": me.video, "screen": me.screen}, exclude=me.id)

    elif t == "chat":
        text = str(msg.get("text", "")).strip()[:CHAT_MAX]
        to = room.peers.get(str(msg.get("to"))) if msg.get("to") else None
        if not text or not _rate(me.chat_hits, 8, 5):
            return
        mode = st.get("chat", "all")
        if mode == "off" or (not effective(room, me)["chat"] and not (to and to.manager)):
            await send(me, {"t": "notice", "text": "Chat is turned off in this meeting." if mode == "off" else "You can't write to everyone in this meeting. You can still message the host privately."})
            return
        entry = {"t": "chat", "id": secrets.token_hex(5), "from": me.id, "name": me.name, "text": text, "ts": int(time.time() * 1000)}
        if to:
            entry |= {"private": True, "to": to.id, "to_name": to.name}
            await asyncio.gather(send(to, entry), send(me, entry) if to.id != me.id else asyncio.sleep(0))
        else:
            room.history = [*room.history[-(HISTORY - 1):], entry]
            await broadcast(room, entry)

    elif t == "react":
        emoji = msg.get("emoji")
        if effective(room, me)["react"] and emoji in EMOJIS and _rate(me.react_hits, 8, 5):
            await broadcast(room, {"t": "react", "from": me.id, "emoji": emoji, "n": secrets.token_hex(3)})

    elif t == "hand":
        up = bool(msg.get("up"))
        if up and me.id not in room.hands:
            room.hands.append(me.id)
        elif not up and me.id in room.hands:
            room.hands.remove(me.id)
        else:
            return
        await send_hands(room)

    elif t == "lower" and me.manager:
        target = str(msg.get("id") or "")
        if msg.get("all"):
            room.hands.clear()
        elif target in room.hands:
            room.hands.remove(target)
        else:
            return
        await send_hands(room)

    elif t in ("mute", "unmute-ask", "camoff") and me.manager:
        target = room.peers.get(str(msg.get("to")))
        if target and target.id != me.id and not (target.owner and not me.owner):   # a co-host can't mute the host
            await send(target, {"t": {"mute": "mute", "unmute-ask": "unmute-ask", "camoff": "camoff"}[t], "by": me.name})

    elif t == "mute-all" and me.manager:
        room.settings["unmute"] = bool(msg.get("allow_unmute", True))
        await broadcast(room, {"t": "settings", "settings": settings_view(room), "title": room.title})
        await send_perms(room)
        await asyncio.gather(*(send(p, {"t": "mute", "by": me.name}) for p in room.peers.values() if not p.manager))

    elif t == "kick" and me.manager:
        target = room.peers.get(str(msg.get("to"))) or room.waiting.get(str(msg.get("to")))
        if target and target.id != me.id and not target.owner and not (target.manager and not me.owner):
            if msg.get("block"):
                room.blocked.add(target.key)
                if target.gid:
                    room.blocked.add(target.gid)
            await send(target, {"t": "kicked", "blocked": bool(msg.get("block"))})
            await close_peer(target, 4411)

    elif t == "admit" and me.manager:
        ids = [w.id for w in room.waiting.values()] if msg.get("all") else [str(msg.get("id"))]
        for i in ids:
            w = room.waiting.get(i)
            if w:
                await admit(room, w)
        await send_waiting(room)

    elif t == "deny" and me.manager:
        w = room.waiting.get(str(msg.get("id")))
        if w:
            room.waiting.pop(w.id, None)
            await send(w, {"t": "denied", "why": "denied"})
            await close_peer(w, 4412)
            await send_waiting(room)

    elif t == "lock" and me.manager:
        room.locked = bool(msg.get("on"))
        await broadcast(room, {"t": "settings", "settings": settings_view(room), "title": room.title})

    elif t == "perm" and me.manager:
        target = room.peers.get(str(msg.get("to")))
        key = msg.get("key")
        if target and not target.manager and key in PERM_KEYS:
            o = room.overrides.setdefault(target.cid, {})
            if msg.get("allow") is None:
                o.pop(key, None)
            else:
                o[key] = bool(msg.get("allow"))
            if not o:
                room.overrides.pop(target.cid, None)
            await send_perms(room, target)
            await send_overrides(room)
            await enforce_now(room, target)

    elif t == "share":
        await handle_share(room, me, msg)

    elif t == "slide":
        sh = room.share
        if sh and sh["kind"] == "present" and (me.cid == sh["cid"] or me.manager):
            try:
                n = max(0, min(999, int(msg.get("n"))))
            except (TypeError, ValueError):
                return
            sh["slide"] = n
            await broadcast(room, {"t": "slide", "n": n}, exclude=me.id)

    elif t == "consent":
        if room.recording and not implied_consent(room, me):
            agree = bool(msg.get("agree"))
            room.consents[me.cid] = agree
            if not agree and room.recording["required"]:
                await decline_removal(room, me)
            await send_consents(room)

    elif t == "captions" and me.manager and st.get("captions"):
        room.captions_on = bool(msg.get("on"))
        await broadcast(room, {"t": "settings", "settings": settings_view(room), "title": room.title})

    elif t == "spotlight" and me.manager:
        target = str(msg.get("id") or "")
        room.spotlight = target if target in room.peers else None
        await broadcast(room, {"t": "spotlight", "id": room.spotlight})

    elif t == "cohost" and me.owner:
        target = room.peers.get(str(msg.get("to")))
        if target and not target.owner:
            on = bool(msg.get("on"))
            target.cohost = on
            (room.cohosts.add if on else room.cohosts.discard)(target.key)
            await broadcast(room, {"t": "cohost", "id": target.id, "on": on})
            await send(target, {"t": "role", "manager": target.manager, "cohost": on, "waiting": waiting_dicts(room) if on else []})
            await send_perms(room, target)
            if on:
                await release_host_waiters(room)

    elif t == "poll" and me.manager:
        act = msg.get("action")
        if act == "create" and len(room.polls) < MAX_POLLS:
            q = str(msg.get("q", "")).strip()[:200]
            opts = [str(o).strip()[:100] for o in (msg.get("options") or []) if str(o).strip()][:8]
            if q and len(opts) >= 2:
                for old in room.polls:
                    old.open = False   # one poll at a time is open
                room.polls.append(Poll(secrets.token_hex(4), q, opts, bool(msg.get("multi")), bool(msg.get("anonymous"))))
                await send_polls(room)
                await broadcast(room, {"t": "notice", "text": f"New poll: {q}", "poll": True}, exclude=me.id)
        else:
            poll = next((x for x in room.polls if x.id == msg.get("id")), None)
            if poll and act == "close":
                poll.open = False
                await send_polls(room)
            elif poll and act == "reopen":
                for old in room.polls:
                    old.open = False
                poll.open = True
                await send_polls(room)
            elif poll and act == "delete":
                room.polls.remove(poll)
                await send_polls(room)

    elif t == "vote":
        poll = next((x for x in room.polls if x.id == msg.get("id")), None)
        if poll and poll.open:
            choices = sorted({int(c) for c in (msg.get("choices") or []) if isinstance(c, int) and 0 <= c < len(poll.options)})
            if not poll.multi:
                choices = choices[:1]
            if choices:
                poll.votes[me.key] = {"name": me.name, "choices": choices}
            else:
                poll.votes.pop(me.key, None)
            await send_polls(room)


def _lookup_doc(doc_id: str, uid: str):
    with connect() as db:
        d = db.execute("SELECT id, title, kind, owner_id, deleted_at, zk FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if not d or d["deleted_at"] or d["owner_id"] != uid:
            return None, "You can only share documents you own."
        if d["zk"]:
            return None, "Encrypted documents can't be shared in a meeting."
        if d["kind"] not in SHARE_KINDS:
            return None, "Only documents, spreadsheets and presentations can be shared."
        return {"title": d["title"] or "Untitled", "kind": d["kind"]}, ""


async def handle_share(room: Room, me: Peer, msg: dict) -> None:
    """Start, stop or change the document everyone is looking at: edited together, or presented slide by slide."""
    act = msg.get("action")
    sh = room.share
    mine = bool(sh and (sh["cid"] == me.cid or me.manager))
    if act == "start":
        mode = msg.get("mode")
        perms = effective(room, me)
        if mode not in ("collab", "present") or not me.uid:
            await send(me, {"t": "notice", "text": "Sign in to share a document."})
            return
        if not perms["collab" if mode == "collab" else "present"]:
            await send(me, {"t": "notice", "text": "You can't share documents in this meeting."})
            return
        if sh and sh["cid"] != me.cid:
            await send(me, {"t": "notice", "text": f"{sh['by']} is already sharing something. Ask them to stop first."})
            return
        if any(p.screen for p in room.peers.values()):
            await send(me, {"t": "notice", "text": "Someone is sharing their screen. Ask them to stop first."})
            return
        doc, why = await asyncio.to_thread(_lookup_doc, str(msg.get("doc_id", "")), me.uid)
        if not doc:
            await send(me, {"t": "notice", "text": why})
            return
        if mode == "present" and doc["kind"] != "slides":
            await send(me, {"t": "notice", "text": "Only presentations can be presented."})
            return
        edit = bool(msg.get("edit")) if isinstance(msg.get("edit"), bool) else bool(room.settings.get("edit_shared", True))
        seek = bool(msg.get("seek")) if isinstance(msg.get("seek"), bool) else bool(room.settings.get("seek", True))
        await set_share(room, {"id": secrets.token_hex(4), "kind": mode, "doc_id": msg["doc_id"], "title": doc["title"], "doc_kind": doc["kind"], "by": me.name, "cid": me.cid,
                               "edit": edit if mode == "collab" else False, "seek": seek, "slide": 0, "since": time.time()})
    elif act == "stop" and mine:
        await set_share(room, None)
    elif act == "edit" and mine and sh["kind"] == "collab":
        sh["edit"] = bool(msg.get("on"))
        await set_share(room, sh)
    elif act == "seek" and mine and sh["kind"] == "present":
        sh["seek"] = bool(msg.get("on"))
        await set_share(room, sh)
