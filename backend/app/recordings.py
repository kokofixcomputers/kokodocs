"""Meeting recordings.

Calls go between browsers (or through the call provider), not through this server, so there is nothing here to record. Instead the browser of a host (or
co-host, if the meeting allows it) draws everyone's video into one picture, mixes the audio, and uploads it in small pieces while it runs. The file is kept
on this server, in the storage of the *host of the meeting*, and counts against their quota like any other file. Everyone in the meeting can see that it is
being recorded and is asked to agree first (see meetroom.py): only people who agreed are in the picture and the mix.

A recording is a WebM (or MP4 in Safari) file that grows as pieces arrive. If the recording browser goes away the recording ends and what arrived is kept.
Files are played and downloaded through short-lived signed addresses, so the <video> element can use them without an Authorization header."""
import asyncio
import re
import secrets
import time

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import quota
from .db import RECORDINGS_DIR, connect, get_db
from .meet import get_meeting, load_settings, norm_code, read_ticket
from .routes import must_user
from .security import ALGO, SECRET

router = APIRouter(prefix="/api")
MAX_CHUNK = 24 * 1024 * 1024
KEY_MINUTES = 120


def _path(rid: str, mime: str):
    return RECORDINGS_DIR / f"{rid}.{'mp4' if 'mp4' in mime else 'webm'}"


def _row(db, rid: str):
    r = db.execute("SELECT * FROM recordings WHERE id = ?", (rid,)).fetchone()
    if not r:
        raise HTTPException(404, "That recording doesn't exist")
    return r


def can_record(settings: dict, state: dict) -> bool:
    mode = settings.get("recording", "host")
    return (mode == "managers" and state["manager"]) or (mode == "host" and state["owner"])


class Start(BaseModel):
    jt: str = Field(max_length=2000)
    mime: str = Field("video/webm", max_length=80)


@router.post("/meet/{code}/recordings")
async def start_recording(code: str, body: Start, db=Depends(get_db)):
    from . import meetroom
    code = norm_code(code)
    t = read_ticket(body.jt, code)
    state = meetroom.member(code, t["i"]) if t else None
    if not t or state is None:
        raise HTTPException(403, "You're not in this meeting.")
    m = get_meeting(db, code)
    s = load_settings(m)
    if not can_record(s, state):
        raise HTTPException(403, {"off": "Recording is turned off for this meeting.", "host": "Only the host can record this meeting.", "managers": "Only hosts can record."}.get(s["recording"], "You can't record this meeting."))
    if not re.match(r"^video/(webm|mp4)\b", body.mime):
        raise HTTPException(422, "Unsupported recording format")
    room = meetroom.rooms.get(code)
    if room is None or room.recording:
        raise HTTPException(409, "This meeting is already being recorded.")
    quota.check(db, m["host_id"], 0, "The host")
    rid = secrets.token_hex(10)
    now = time.time()
    me = next((p for p in room.peers.values() if p.cid == t["i"]), None)
    db.execute("INSERT INTO recordings (id, owner_id, meeting_code, title, started_by, cid, status, mime, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'recording', ?, ?, ?)",
               (rid, m["host_id"], code, m["title"], me.name if me else t["n"], t["i"], body.mime.split(";")[0], now, now))
    db.commit()
    await meetroom.set_recording(code, {"id": rid, "by": me.name if me else t["n"], "cid": t["i"], "since": now, "required": bool(s["record_consent"])})
    return {"id": rid, "required": bool(s["record_consent"])}


@router.put("/meet/{code}/recordings/{rid}/chunk")
async def recording_chunk(code: str, rid: str, request: Request, seq: int, x_meet_ticket: str = Header(...), db=Depends(get_db)):
    t = read_ticket(x_meet_ticket, code)
    r = _row(db, rid)
    if not t or t["i"] != r["cid"] or r["meeting_code"] != norm_code(code):
        raise HTTPException(403, "This isn't your recording.")
    if r["status"] != "recording":
        raise HTTPException(410, "This recording has ended.")
    if int(request.headers.get("content-length") or 0) > MAX_CHUNK:
        raise HTTPException(413, "That piece is too large")
    data = await request.body()
    if len(data) > MAX_CHUNK:
        raise HTTPException(413, "That piece is too large")
    if seq < r["chunks"]:
        return {"ok": True, "size": r["size"]}   # a retry of a piece that already arrived
    if seq > r["chunks"]:
        raise HTTPException(409, f"Expected piece {r['chunks']}")
    try:
        quota.check(db, r["owner_id"], len(data), "The host")
    except HTTPException:
        await finish(rid)   # out of space: keep what there is, and tell everyone it stopped
        raise
    def write():
        with open(_path(rid, r["mime"]), "ab") as f:
            f.write(data)
    await asyncio.to_thread(write)
    db.execute("UPDATE recordings SET size = size + ?, chunks = chunks + 1, updated_at = ? WHERE id = ?", (len(data), time.time(), rid))
    db.commit()
    return {"ok": True, "size": r["size"] + len(data)}


class Stop(BaseModel):
    jt: str = Field(max_length=2000)
    duration_ms: int = Field(0, ge=0, le=7 * 24 * 3600 * 1000)


@router.post("/meet/{code}/recordings/{rid}/stop")
async def stop_recording(code: str, rid: str, body: Stop, db=Depends(get_db)):
    t = read_ticket(body.jt, code)
    r = _row(db, rid)
    if not t or t["i"] != r["cid"]:
        raise HTTPException(403, "This isn't your recording.")
    await finish(rid, duration_ms=body.duration_ms)
    return {"ok": True}


async def finish(rid: str, duration_ms: int = 0, tell_room: bool = True) -> None:
    """End a recording: keep what arrived (nothing arrived: forget it), and tell the meeting."""
    def work():
        with connect() as db:
            r = db.execute("SELECT * FROM recordings WHERE id = ?", (rid,)).fetchone()
            if not r:
                return None
            if r["status"] == "recording":
                if r["size"] <= 0:
                    db.execute("DELETE FROM recordings WHERE id = ?", (rid,))
                    for f in RECORDINGS_DIR.glob(f"{rid}.*"):
                        f.unlink(missing_ok=True)
                else:
                    db.execute("UPDATE recordings SET status = 'done', duration_ms = CASE WHEN ? > 0 THEN ? ELSE duration_ms END, updated_at = ? WHERE id = ?", (duration_ms, duration_ms, time.time(), rid))
                db.commit()
            return r["meeting_code"]
    code = await asyncio.to_thread(work)
    if code and tell_room:
        from . import meetroom
        room = meetroom.rooms.get(code)
        if room and room.recording and room.recording["id"] == rid:
            await meetroom.set_recording(code, None)


def item(r) -> dict:
    return {"id": r["id"], "title": r["title"], "code": r["meeting_code"], "by": r["started_by"], "status": r["status"], "mime": r["mime"], "size": r["size"],
            "duration_ms": r["duration_ms"], "created_at": r["created_at"]}


@router.get("/recordings")
def my_recordings(user=Depends(must_user), db=Depends(get_db)):
    rows = db.execute("SELECT * FROM recordings WHERE owner_id = ? ORDER BY created_at DESC LIMIT 500", (user["id"],)).fetchall()
    return {"items": [item(r) for r in rows], "total": sum(r["size"] for r in rows)}


def _key(rid: str, uid: str) -> str:
    return jwt.encode({"typ": "rec", "r": rid, "u": uid, "exp": time.time() + KEY_MINUTES * 60}, SECRET, ALGO)


@router.get("/recordings/{rid}")
def recording_info(rid: str, user=Depends(must_user), db=Depends(get_db)):
    r = _row(db, rid)
    if r["owner_id"] != user["id"]:
        raise HTTPException(403, "This recording belongs to someone else")
    return {**item(r), "url": f"/api/recordings/{rid}/file?k={_key(rid, user['id'])}"}


@router.get("/recordings/{rid}/file")
def recording_file(rid: str, k: str, download: int = 0, db=Depends(get_db)):
    try:
        p = jwt.decode(k, SECRET, algorithms=[ALGO])
    except jwt.PyJWTError:
        raise HTTPException(403, "This link has expired. Open the recording again.")
    if p.get("typ") != "rec" or p.get("r") != rid:
        raise HTTPException(403, "This link isn't for that recording.")
    r = _row(db, rid)
    path = _path(rid, r["mime"])
    if not path.exists():
        raise HTTPException(404, "The file is gone")
    name = re.sub(r'[^\w .()-]+', "", f"{r['title']} {time.strftime('%Y-%m-%d %H.%M', time.localtime(r['created_at']))}").strip() or "meeting"
    ext = "mp4" if "mp4" in r["mime"] else "webm"
    headers = {"Content-Disposition": f'{"attachment" if download else "inline"}; filename="{name}.{ext}"', "Cache-Control": "private, max-age=300"}
    return FileResponse(path, media_type=r["mime"], headers=headers)


@router.delete("/recordings/{rid}")
async def delete_recording(rid: str, user=Depends(must_user), db=Depends(get_db)):
    r = _row(db, rid)
    if r["owner_id"] != user["id"]:
        raise HTTPException(403, "This recording belongs to someone else")
    if r["status"] == "recording":
        await finish(rid)
    quota.drop_recordings(db, "id = ?", (rid,))
    db.commit()
    return {"ok": True}
