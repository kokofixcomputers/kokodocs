"""Realtime collaboration: a Yjs relay + persistence over WebSockets.

Frame format (binary): first byte = message type, rest = payload.
  0 = Yjs update   1 = awareness update (cursors / presence)   2 = ping (answered with the same frame: lets a client
  notice a connection that died without telling it, so it can reconnect and merge what it missed)
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
MSG_UPDATE, MSG_AWARENESS, MSG_PING = 0, 1, 2
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


async def refresh_access(doc_id: str) -> None:
    """Re-evaluate everyone connected to a doc after its sharing changed.
    Anyone whose role differs (or who lost access) is disconnected; their client reloads with the new role."""
    room = rooms.get(doc_id)
    if not room:
        return

    def roles():
        with connect() as db:
            doc = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if not doc:
                return {}
            return {id(c): access.resolve(db, doc, access.get_user(db, c.token), c.doc_token).role for c in room.conns}

    now = await asyncio.to_thread(roles)
    for c in list(room.conns):
        if now.get(id(c)) != c.role:
            try:
                await c.ws.close(code=ACCESS_CHANGED)
            except Exception:
                pass


async def refresh_all() -> None:
    for did in list(rooms):
        await refresh_access(did)


@router.websocket("/ws/docs/{doc_id}")
async def ws_doc(ws: WebSocket, doc_id: str):
    token = ws.query_params.get("token")
    doc_token = ws.query_params.get("doc_token")

    def authorize():
        with connect() as db:
            doc = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if not doc:
                return None, "Guest"
            user = access.get_user(db, token)
            return access.resolve(db, doc, user, doc_token).role, (user["name"] if user else "Guest")

    role, who = await asyncio.to_thread(authorize)
    if not role:
        await ws.close(code=4403)
        return
    await ws.accept()

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
