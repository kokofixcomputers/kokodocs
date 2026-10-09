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
            return {"manager": p.manager}
    return None


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
    return {"id": p.id, "cid": p.cid, "name": p.name, "host": p.owner, "cohost": p.cohost, "audio": p.audio, "video": p.video, "screen": p.screen}


def settings_view(room: Room) -> dict:
    return {**room.settings, "locked": room.locked, "captions_on": room.captions_on and bool(room.settings.get("captions"))}


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
    lst = [{"id": p.id, "name": p.name, "reason": p.waiting} for p in room.waiting.values()]
    await broadcast(room, {"t": "waiting-list", "list": lst}, managers_only=True)


async def send_hands(room: Room) -> None:
    await broadcast(room, {"t": "hands", "order": room.hands})


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
               "started": int(room.started * 1000), "provider": room.provider, "emojis": EMOJIS,
               "polls": [poll_view(x, p) for x in room.polls]}
    if p.manager:
        welcome["waiting"] = [{"id": w.id, "name": w.name, "reason": w.waiting} for w in room.waiting.values()]
    await send(p, welcome)
    await broadcast(room, {"t": "joined", "peer": public(room, p)}, exclude=p.id)
    if p.manager:
        await release_host_waiters(room)
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
                await send(p, {"t": "role", "manager": p.manager, "cohost": want, "waiting": [{"id": w.id, "name": w.name, "reason": w.waiting} for w in room.waiting.values()] if want else []})
                if want:
                    await release_host_waiters(room)
    await broadcast(room, {"t": "settings", "settings": settings_view(room), "title": title})
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
    if not room.peers and not room.waiting and rooms.get(room.code) is room:
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
        screen = bool(msg.get("screen"))
        if screen and st.get("share") == "host" and not me.manager:
            screen = False
            await send(me, {"t": "force", "screen": False, "text": "Only the host can share their screen in this meeting."})
        me.audio, me.video, me.screen = bool(msg.get("audio")), bool(msg.get("video")), screen
        await broadcast(room, {"t": "state", "id": me.id, "audio": me.audio, "video": me.video, "screen": me.screen}, exclude=me.id)

    elif t == "chat":
        text = str(msg.get("text", "")).strip()[:CHAT_MAX]
        to = room.peers.get(str(msg.get("to"))) if msg.get("to") else None
        if not text or not _rate(me.chat_hits, 8, 5):
            return
        mode = st.get("chat", "all")
        if mode == "off" or (mode == "host" and not me.manager and not (to and to.manager)):
            await send(me, {"t": "notice", "text": "Chat is turned off in this meeting." if mode == "off" else "Only the host can write in the chat. You can still message the host privately."})
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
        if st.get("reactions", True) and emoji in EMOJIS and _rate(me.react_hits, 8, 5):
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
            await send(target, {"t": "role", "manager": target.manager, "cohost": on, "waiting": [{"id": w.id, "name": w.name, "reason": w.waiting} for w in room.waiting.values()] if on else []})
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
