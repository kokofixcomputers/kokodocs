"""Realtime collaboration: a Yjs relay + persistence over WebSockets.

Frame format (binary): first byte = message type, rest = payload.
  0 = Yjs update   1 = awareness update (cursors / presence)   2 = ping (answered with the same frame: lets a client
  notice a connection that died without telling it, so it can reconnect and merge what it missed)
  3 = comments changed (server to client only, no payload): the client fetches the list again, so comments need no polling
Encrypted documents (see zk.py) use the same frame types, but the server can't read or merge anything, so it only relays and stores:
  0 = update       client to server: an encrypted update. Server to client: varint(update number) + encrypted update
  5 = ready        server to client, after the stored history: varint(how many updates came after the snapshot) + varint(newest update number)
  6 = checkpoint   server to client: varint(snapshot covers updates up to this number) + encrypted snapshot. Client to server: the same,
                   and the server then forgets the updates the snapshot covers
Viewers can receive everything but their document updates are dropped.
"""
import asyncio
import time
from dataclasses import dataclass, field

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pycrdt import Doc

from . import access
from . import searchindex
from .db import connect
from .snapshots import AUTO_INTERVAL, CLOSE_MIN_GAP, latest_time, take_snapshot

router = APIRouter()
MSG_UPDATE, MSG_AWARENESS, MSG_PING, MSG_COMMENTS, MSG_ZK_READY, MSG_ZK_CHECKPOINT = 0, 1, 2, 3, 5, 6
MAX_FRAME = 16 * 1024 * 1024


def read_var(buf: bytes, i: int) -> tuple[int, int]:
    n = shift = 0
    while True:
        b = buf[i]
        i += 1
        n |= (b & 0x7F) << shift
        if b < 0x80:
            return n, i
        shift += 7


def write_var(n: int) -> bytes:
    out = bytearray()
    while n > 0x7F:
        out.append(0x80 | (n & 0x7F))
        n >>= 7
    out.append(n)
    return bytes(out)


def awareness_clients(payload: bytes) -> dict[int, int]:
    """client id -> clock, parsed from a y-protocols awareness update."""
    res: dict[int, int] = {}
    try:
        count, i = read_var(payload, 0)
        for _ in range(count):
            cid, i = read_var(payload, i)
            clock, i = read_var(payload, i)
            ln, i = read_var(payload, i)
            i += ln
            res[cid] = clock
    except IndexError:
        pass
    return res


def removal_frame(clients: dict[int, int]) -> bytes:
    body = write_var(len(clients))
    for cid, clock in clients.items():
        body += write_var(cid) + write_var(clock + 1) + write_var(4) + b"null"
    return bytes([MSG_AWARENESS]) + body


@dataclass
class Conn:
    ws: WebSocket
    role: str
    token: str | None = None
    doc_token: str | None = None
    synced: bool = False
    name: str = "Guest"
    awareness: bytes | None = None
    clients: dict[int, int] = field(default_factory=dict)


@dataclass
class Room:
    id: str
    doc: Doc
    conns: list[Conn] = field(default_factory=list)
    save_task: asyncio.Task | None = None
    dirty: bool = False
    last_snap: float = 0.0
    snap_dirty: bool = False
    editors: set = field(default_factory=set)


rooms: dict[str, Room] = {}
_lock = asyncio.Lock()


def _load(doc_id: str) -> Doc:
    doc = Doc()
    with connect() as db:
        row = db.execute("SELECT ydoc FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if row and row["ydoc"]:
        doc.apply_update(bytes(row["ydoc"]))
    return doc


def _write(doc_id: str, update: bytes) -> None:
    with connect() as db:
        db.execute("UPDATE documents SET ydoc = ?, updated_at = ? WHERE id = ?", (update, time.time(), doc_id))
        try:
            searchindex.index_doc(db, doc_id, update)
        except Exception:
            pass


async def flush(room: Room) -> None:
    if room.dirty:
        room.dirty = False
        await asyncio.to_thread(_write, room.id, room.doc.get_update())


async def maybe_snapshot(room: Room, min_gap: float) -> None:
    """Record a version if the doc changed since the last one and enough time has passed."""
    if not room.snap_dirty or time.time() - room.last_snap < min_gap:
        return
    room.snap_dirty = False
    authors, room.editors = list(room.editors), set()
    blob = room.doc.get_update()
    room.last_snap = time.time()
    await asyncio.to_thread(take_snapshot, room.id, blob, "auto", None, authors)


async def _debounced_save(room: Room) -> None:
    await asyncio.sleep(0.8)
    room.save_task = None
    await flush(room)
    await maybe_snapshot(room, AUTO_INTERVAL)


def schedule_save(room: Room) -> None:
    room.dirty = True
    if room.save_task is None:
        room.save_task = asyncio.create_task(_debounced_save(room))


async def broadcast(room: Room, frame: bytes, exclude: Conn | None = None) -> None:
    for c in list(room.conns):
        if c is exclude:
            continue
        try:
            await c.ws.send_bytes(frame)
        except Exception:
            pass


ACCESS_CHANGED = 4002
_loop: asyncio.AbstractEventLoop | None = None


def notify_comments(doc_id: str) -> None:
    """Tell everyone connected to a document that its comments changed. Safe to call from the threads that run the REST handlers."""
    room = rooms.get(doc_id)
    if not room or not _loop:
        return
    try:
        asyncio.run_coroutine_threadsafe(broadcast(room, bytes([MSG_COMMENTS, 0])), _loop)
    except Exception:
        pass


async def refresh_access(doc_id: str) -> None:
    """Re-evaluate everyone connected to a doc after its sharing changed.
    Anyone whose role differs (or who lost access) is disconnected; their client reloads with the new role."""
    room = rooms.get(doc_id)
    everyone = (list(room.conns) if room else []) + list(zk_conns.get(doc_id, []))   # encrypted documents' connections too
    if not everyone:
        return

    def roles():
        with connect() as db:
            doc = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if not doc:
                return {}
            return {id(c): access.resolve(db, doc, access.get_user(db, c.token), c.doc_token).role for c in everyone}

    now = await asyncio.to_thread(roles)
    for c in everyone:
        if now.get(id(c)) != c.role:
            try:
                await c.ws.close(code=ACCESS_CHANGED)
            except Exception:
                pass


async def refresh_all() -> None:
    for did in list(rooms):
        await refresh_access(did)


# ───────────── encrypted documents: relay and store, never read ─────────────
zk_conns: dict[str, list[Conn]] = {}
zk_locks: dict[str, asyncio.Lock] = {}


def _zk_load(doc_id: str):
    with connect() as db:
        cp = db.execute("SELECT upto, blob FROM zk_checkpoints WHERE doc_id = ?", (doc_id,)).fetchone()
        ups = db.execute("SELECT id, blob FROM zk_updates WHERE doc_id = ? AND id > ? ORDER BY id", (doc_id, cp["upto"] if cp else 0)).fetchall()
        return (cp["upto"], bytes(cp["blob"])) if cp else None, [(u["id"], bytes(u["blob"])) for u in ups]


def _zk_append(doc_id: str, blob: bytes) -> int:
    with connect() as db:
        cur = db.execute("INSERT INTO zk_updates (doc_id, blob, created_at) VALUES (?,?,?)", (doc_id, blob, time.time()))
        db.execute("UPDATE documents SET updated_at = ? WHERE id = ?", (time.time(), doc_id))
        return cur.lastrowid


def _zk_checkpoint(doc_id: str, upto: int, blob: bytes) -> bool:
    with connect() as db:
        cp = db.execute("SELECT upto FROM zk_checkpoints WHERE doc_id = ?", (doc_id,)).fetchone()
        newest = db.execute("SELECT COALESCE(MAX(id), 0) AS m FROM zk_updates WHERE doc_id = ?", (doc_id,)).fetchone()["m"]
        if upto > max(newest, cp["upto"] if cp else 0) or (cp and upto < cp["upto"]):
            return False   # claims updates that don't exist, or is older than the snapshot already kept
        db.execute("INSERT OR REPLACE INTO zk_checkpoints (doc_id, upto, blob, created_at) VALUES (?,?,?,?)", (doc_id, upto, blob, time.time()))
        db.execute("DELETE FROM zk_updates WHERE doc_id = ? AND id <= ?", (doc_id, upto))
        return True


async def _relay(conns: list[Conn], frame: bytes, exclude: Conn | None = None) -> None:
    for c in list(conns):
        if c is not exclude:
            try:
                await c.ws.send_bytes(frame)
            except Exception:
                pass


async def evict_room(doc_id: str) -> None:
    """A document was converted between plain and encrypted (or re-keyed): drop everyone, so they reconnect to what it is now."""
    room = rooms.pop(doc_id, None)
    if room:
        if room.save_task:
            room.save_task.cancel()
        for c in list(room.conns):
            try:
                await c.ws.close(code=ACCESS_CHANGED)
            except Exception:
                pass
    for c in list(zk_conns.get(doc_id, [])):
        try:
            await c.ws.close(code=ACCESS_CHANGED)
        except Exception:
            pass


async def zk_session(ws: WebSocket, doc_id: str, role: str, token, doc_token, who: str) -> None:
    conn = Conn(ws, role, token, doc_token, name=who)
    lock = zk_locks.setdefault(doc_id, asyncio.Lock())
    async with lock:   # nobody's update can slip in between what is sent now and the live stream that follows
        zk_conns.setdefault(doc_id, []).append(conn)
        try:
            cp, ups = await asyncio.to_thread(_zk_load, doc_id)
            if cp:
                await ws.send_bytes(bytes([MSG_ZK_CHECKPOINT]) + write_var(cp[0]) + cp[1])
            for uid, blob in ups:
                await ws.send_bytes(bytes([MSG_UPDATE]) + write_var(uid) + blob)
            newest = ups[-1][0] if ups else (cp[0] if cp else 0)
            await ws.send_bytes(bytes([MSG_ZK_READY]) + write_var(len(ups)) + write_var(newest))
            for other in zk_conns[doc_id]:
                if other is not conn and other.awareness:
                    await ws.send_bytes(other.awareness)
        except Exception:
            zk_conns[doc_id].remove(conn)
            return
    try:
        while True:
            data = await ws.receive_bytes()
            if len(data) < 2 or len(data) > MAX_FRAME:
                continue
            kind = data[0]
            if kind == MSG_UPDATE:
                if role == "viewer":
                    continue
                async with lock:
                    uid = await asyncio.to_thread(_zk_append, doc_id, data[1:])
                    frame = bytes([MSG_UPDATE]) + write_var(uid) + data[1:]
                    await _relay(zk_conns[doc_id], frame)
            elif kind == MSG_ZK_CHECKPOINT:
                if role == "viewer":
                    continue
                try:
                    upto, i = read_var(data, 1)
                except IndexError:
                    continue
                async with lock:
                    await asyncio.to_thread(_zk_checkpoint, doc_id, upto, data[i:])
            elif kind == MSG_PING:
                await ws.send_bytes(bytes([MSG_PING, 0]))
            elif kind == MSG_AWARENESS:
                conn.awareness = data   # encrypted: the server can't tell whose cursor it is, only pass it on
                await _relay(zk_conns[doc_id], data, conn)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if conn in zk_conns.get(doc_id, []):
            zk_conns[doc_id].remove(conn)
        if not zk_conns.get(doc_id):
            zk_conns.pop(doc_id, None)
            zk_locks.pop(doc_id, None)


@router.websocket("/ws/docs/{doc_id}")
async def ws_doc(ws: WebSocket, doc_id: str):
    token = ws.query_params.get("token")
    doc_token = ws.query_params.get("doc_token")

    def authorize():
        with connect() as db:
            doc = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if not doc:
                return None, "Guest", False
            user = access.get_user(db, token)
            return access.resolve(db, doc, user, doc_token).role, (user["name"] if user else "Guest"), bool(doc["zk"])

    role, who, is_zk = await asyncio.to_thread(authorize)
    if not role:
        await ws.close(code=4403)
        return
    await ws.accept()
    global _loop
    _loop = asyncio.get_running_loop()
    if is_zk:
        await zk_session(ws, doc_id, role, token, doc_token, who)
        return

    async with _lock:
        room = rooms.get(doc_id)
        if not room:
            room = Room(doc_id, await asyncio.to_thread(_load, doc_id))
            room.last_snap = await asyncio.to_thread(latest_time, doc_id)
            rooms[doc_id] = room
        conn = Conn(ws, role, token, doc_token, name=who)
        room.conns.append(conn)

    try:
        await ws.send_bytes(bytes([MSG_UPDATE]) + room.doc.get_update())
        for other in room.conns:
            if other is not conn and other.awareness:
                await ws.send_bytes(other.awareness)
        while True:
            data = await ws.receive_bytes()
            if len(data) < 2 or len(data) > MAX_FRAME:
                continue
            kind = data[0]
            if kind == MSG_UPDATE:
                if role == "viewer":
                    continue
                # A client's first message is its full state (idempotent resync); skip re-broadcasting it
                # when it adds nothing. NOTE: never use the state vector to detect "no change" for later
                # messages: deletions don't advance it, so a backspace would be silently dropped.
                first = not conn.synced
                conn.synced = True
                before = room.doc.get_update() if first else None
                try:
                    room.doc.apply_update(data[1:])
                except Exception:
                    continue
                if first and room.doc.get_update() == before:
                    continue
                room.snap_dirty = True
                room.editors.add(conn.name)
                schedule_save(room)
                await broadcast(room, data, exclude=conn)
            elif kind == MSG_PING:
                await ws.send_bytes(bytes([MSG_PING, 0]))
            elif kind == MSG_AWARENESS:
                conn.awareness = data
                conn.clients.update(awareness_clients(data[1:]))
                await broadcast(room, data, exclude=conn)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        async with _lock:
            if conn in room.conns:
                room.conns.remove(conn)
            if conn.clients:
                await broadcast(room, removal_frame(conn.clients))
            if not room.conns:
                if room.save_task:
                    room.save_task.cancel()
                    room.save_task = None
                await flush(room)
                await maybe_snapshot(room, CLOSE_MIN_GAP)
                rooms.pop(doc_id, None)
