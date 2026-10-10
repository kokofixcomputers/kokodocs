import asyncio
import hashlib
import ipaddress
import os
import re
import secrets
import socket
import time
import uuid
from typing import Literal
from urllib.parse import urljoin, urlparse

import httpx

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from . import access, quota, tagdb
from .collab import refresh_access
from .db import UPLOAD_DIR, get_db, settings_get
from . import stt
from .proofread import check_blocks
from .security import (
    RateLimiter,
    check_password,
    hash_password,
    make_doc_token,
    make_mfa_token,
    make_token,
)

router = APIRouter(prefix="/api")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
COLORS = ["#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6", "#ef4444", "#0ea5e9", "#22c55e", "#f97316", "#d946ef"]
login_limiter = RateLimiter(10, 60)
unlock_limiter = RateLimiter(8, 60)
stt_limiter = RateLimiter(20, 60)
proofread_limiter = RateLimiter(240, 60)   # it runs as people edit, a few times a minute
draft_limiter = RateLimiter(240, 60)   # live previews are small and free, so they get a much bigger allowance


def bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def current_user(authorization: str | None = Header(None), db=Depends(get_db)):
    return access.get_user(db, bearer(authorization))


def must_admin(user=Depends(current_user)):
    if not user:
        raise HTTPException(401, {"code": "login_required", "message": "Please sign in"})
    if not access.is_admin(user):
        raise HTTPException(403, "Admins only")
    return user


def must_user(user=Depends(current_user)):
    if not user:
        raise HTTPException(401, {"code": "login_required", "message": "Please sign in"})
    return user


def public_user(u) -> dict:
    return {"id": u["id"], "email": u["email"], "name": u["name"], "color": u["color"], "is_admin": access.is_admin(u), "has_password": bool(u["pw_set"]), "notify_email": bool(u["notify_email"]), "totp": bool(u["totp_enabled"]), "google": u["google_email"], "zk": bool(u["zk_enabled"]), "zk_pub": u["zk_pub"]}


# ───────────────────────── auth ─────────────────────────
class SignupIn(BaseModel):
    email: str
    name: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/auth/signup")
def signup(body: SignupIn, db=Depends(get_db)):
    if not settings_get(db, "signup_enabled", "1") == "1":
        raise HTTPException(403, "Sign-ups are currently closed")
    from .emailauth import email_enabled
    if email_enabled(db):
        raise HTTPException(400, {"code": "email_required", "message": "Confirm your email to create an account"})
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "Enter a valid email address")
    if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        raise HTTPException(409, "An account with this email already exists")
    uid = uuid.uuid4().hex
    color = COLORS[secrets.randbelow(len(COLORS))]
    db.execute(
        "INSERT INTO users (id, email, name, password_hash, color, created_at) VALUES (?,?,?,?,?,?)",
        (uid, email, body.name.strip(), hash_password(body.password), color, time.time()),
    )
    user = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    return {"token": make_token(uid), "user": public_user(user)}


@router.post("/auth/login")
def login(body: LoginIn, request: Request, db=Depends(get_db)):
    email = body.email.strip().lower()
    key = f"{request.client.host if request.client else '?'}:{email}"
    if not login_limiter.allow(key):
        raise HTTPException(429, "Too many attempts. Try again in a minute.")
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Incorrect email or password")
    if user["disabled"]:
        raise HTTPException(403, "This account has been suspended")
    if user["totp_enabled"]:
        return {"mfa_required": True, "mfa_token": make_mfa_token(user["id"])}
    return {"token": make_token(user["id"]), "user": public_user(user)}


@router.get("/me/storage")
def my_storage(user=Depends(must_user), db=Depends(get_db)):
    return quota.status(db, user)


@router.get("/me/storage/items")
def my_storage_items(user=Depends(must_user), db=Depends(get_db)):
    return quota.per_document(db, user["id"])


@router.get("/ping")
def ping():
    """Is the server reachable? (The desktop app and the page check this while offline.)"""
    return {"ok": True}


@router.get("/auth/me")
def me(user=Depends(must_user)):
    return public_user(user)


# ───────────────────────── documents ─────────────────────────
def sealed_for(db, user, d) -> str | None:
    """The key to an encrypted document, sealed to this person (None for a plain document, or if they were never given one)."""
    if not user or not d["zk"]:
        return None
    r = db.execute("SELECT sealed FROM zk_grants WHERE doc_id = ? AND email = ?", (d["id"], user["email"])).fetchone()
    return r["sealed"] if r else None


def doc_summary(d, role: str, owner_name: str | None = None, starred: bool = False, tags: list[str] | None = None, sealed: str | None = None) -> dict:
    return {
        "zk": bool(d["zk"]), "zk_title": d["zk_title"], "zk_sealed": sealed,
        "starred": starred,
        "tags": tags or [],
        "id": d["id"],
        "title": d["title"],
        "role": role,
        "owner": owner_name,
        "folder_id": d["folder_id"],
        "kind": d["kind"],
        "updated_at": d["updated_at"],
        "created_at": d["created_at"],
        "link_access": d["link_access"],
    }


@router.get("/docs")
def list_docs(user=Depends(must_user), db=Depends(get_db)):
    mine = db.execute(
        "SELECT * FROM documents WHERE owner_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC", (user["id"],)
    ).fetchall()
    shared = db.execute(
        """SELECT d.*, s.role AS srole, u.name AS owner_name FROM shares s
           JOIN documents d ON d.id = s.doc_id JOIN users u ON u.id = d.owner_id
           WHERE s.email = ? AND d.deleted_at IS NULL ORDER BY d.updated_at DESC""",
        (user["email"],),
    ).fetchall()
    starred = {r["doc_id"] for r in db.execute("SELECT doc_id FROM stars WHERE user_id = ?", (user["id"],))}
    tags = tagdb.tag_map(db, "doc", user["id"])
    keys = {r["doc_id"]: r["sealed"] for r in db.execute("SELECT doc_id, sealed FROM zk_grants WHERE email = ?", (user["email"],))}   # the keys sealed to this person
    return {
        "mine": [doc_summary(d, "owner", user["name"], d["id"] in starred, tags.get(d["id"]), keys.get(d["id"])) for d in mine],
        "shared": [doc_summary(d, d["srole"], d["owner_name"], d["id"] in starred, tags.get(d["id"]), keys.get(d["id"])) for d in shared if not d["zk"] or user["zk_enabled"]],
    }


class CreateDoc(BaseModel):
    id: str | None = Field(None, pattern=r"^[0-9a-f]{16}$")   # chosen by the desktop app when it makes a document offline; creating it again later is harmless
    title: str | None = Field(None, max_length=200)
    folder_id: str | None = None
    kind: Literal["doc", "sheet", "slides", "form", "wiki", "board"] = "doc"


@router.post("/docs")
def create_doc(body: CreateDoc, user=Depends(must_user), db=Depends(get_db)):
    if body.id:
        have = db.execute("SELECT * FROM documents WHERE id = ?", (body.id,)).fetchone()
        if have:   # asked again (the first answer was lost, or the same offline queue ran twice): the same document, not a second one
            if have["owner_id"] != user["id"]:
                raise HTTPException(409, {"code": "exists", "message": "That id is taken"})
            return doc_summary(have, "owner", user["name"])
    quota.check(db, user["id"], 0)
    did, now = body.id or uuid.uuid4().hex[:16], time.time()
    folder = body.folder_id
    if folder and not db.execute("SELECT 1 FROM folders WHERE id = ? AND owner_id = ?", (folder, user["id"])).fetchone():
        folder = None
    db.execute(
        "INSERT INTO documents (id, owner_id, title, folder_id, kind, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
        (did, user["id"], (body.title or "").strip() or ({"sheet": "Untitled spreadsheet", "slides": "Untitled presentation", "form": "Untitled form", "wiki": "Untitled wiki", "board": "Untitled board"}.get(body.kind, "Untitled document")), folder, body.kind, now, now),
    )
    return doc_summary(db.execute("SELECT * FROM documents WHERE id = ?", (did,)).fetchone(), "owner", user["name"])


def ctx(authorization: str | None = Header(None), x_doc_token: str | None = Header(None)):
    return bearer(authorization), x_doc_token


@router.put("/docs/{doc_id}/star")
def star_doc(doc_id: str, c=Depends(ctx), user=Depends(must_user), db=Depends(get_db)):
    access.require(db, doc_id, *c)
    db.execute("INSERT OR IGNORE INTO stars (user_id, doc_id, created_at) VALUES (?,?,?)", (user["id"], doc_id, time.time()))
    db.commit()
    return {"starred": True}


@router.delete("/docs/{doc_id}/star")
def unstar_doc(doc_id: str, user=Depends(must_user), db=Depends(get_db)):
    db.execute("DELETE FROM stars WHERE user_id = ? AND doc_id = ?", (user["id"], doc_id))
    db.commit()
    return {"starred": False}


@router.get("/recent")
def recent_docs(limit: int = 8, user=Depends(must_user), db=Depends(get_db)):
    """Files you opened lately that you can still open (skips ones that were deleted or unshared)."""
    rows = db.execute("""SELECT d.*, r.opened_at, u.name AS owner_name FROM recents r JOIN documents d ON d.id = r.doc_id JOIN users u ON u.id = d.owner_id
                         WHERE r.user_id = ? AND d.deleted_at IS NULL ORDER BY r.opened_at DESC LIMIT 40""", (user["id"],)).fetchall()
    starred = {r["doc_id"] for r in db.execute("SELECT doc_id FROM stars WHERE user_id = ?", (user["id"],))}
    out = []
    for d in rows:
        acc = access.resolve(db, d, user, None)
        if not acc.role:
            continue
        out.append({**doc_summary(d, acc.role, d["owner_name"], d["id"] in starred, sealed=sealed_for(db, user, d)), "opened_at": d["opened_at"]})
        if len(out) >= min(max(limit, 1), 24):
            break
    return out


@router.get("/docs/{doc_id}")
def get_doc(doc_id: str, c=Depends(ctx), db=Depends(get_db)):
    doc, acc = access.require(db, doc_id, *c)
    owner = db.execute("SELECT name, email FROM users WHERE id = ?", (doc["owner_id"],)).fetchone()
    starred = False
    if acc.user:   # remember what this person opened, for the Recent row
        db.execute("INSERT INTO recents (user_id, doc_id, opened_at) VALUES (?,?,?) ON CONFLICT(user_id, doc_id) DO UPDATE SET opened_at = excluded.opened_at", (acc.user["id"], doc_id, time.time()))
        starred = bool(db.execute("SELECT 1 FROM stars WHERE user_id = ? AND doc_id = ?", (acc.user["id"], doc_id)).fetchone())
        db.commit()
    return {
        **doc_summary(doc, acc.role, owner["name"], starred, sealed=(db.execute("SELECT sealed FROM zk_grants WHERE doc_id = ? AND email = ?", (doc_id, acc.user["email"])).fetchone() or {"sealed": None})["sealed"] if acc.user and doc["zk"] else None),
        "owner_email": owner["email"],
        "link": {"access": doc["link_access"], "role": "viewer" if doc["kind"] == "form" else doc["link_role"]},
    }


@router.get("/docs/{doc_id}/state")
def doc_state(doc_id: str, c=Depends(ctx), db=Depends(get_db)):
    """The whole document as one Yjs update: the desktop app and the offline copy download this to keep a local copy."""
    from . import collab
    doc, _ = access.require(db, doc_id, *c)
    access.zk_unsupported(doc, "An offline copy")
    room = collab.rooms.get(doc_id)
    data = room.doc.get_update() if room else bytes(doc["ydoc"] or b"")
    return Response(data, media_type="application/octet-stream", headers={"Cache-Control": "no-store"})


class PatchDoc(BaseModel):
    title: str = Field("", max_length=200)
    zk_title: str | None = Field(None, max_length=4000)   # encrypted documents: the title, encrypted by the browser


@router.patch("/docs/{doc_id}")
def patch_doc(doc_id: str, body: PatchDoc, c=Depends(ctx), db=Depends(get_db)):
    doc, _ = access.require(db, doc_id, *c, minimum="editor")
    if doc["zk"]:
        if not body.zk_title:
            raise HTTPException(422, "An encrypted document's title has to be encrypted first")
        db.execute("UPDATE documents SET zk_title = ?, updated_at = ? WHERE id = ?", (body.zk_title, time.time(), doc_id))
        return {"ok": True}
    db.execute(
        "UPDATE documents SET title = ?, updated_at = ? WHERE id = ?",
        (body.title.strip() or "Untitled document", time.time(), doc_id),
    )
    try:
        db.execute("UPDATE doc_fts SET title = ? WHERE doc_id = ?", (body.title.strip() or "Untitled document", doc_id))
    except Exception:
        pass
    return {"ok": True}


@router.delete("/docs/{doc_id}")
async def delete_doc(doc_id: str, c=Depends(ctx), db=Depends(get_db)):
    """Moves the document to the recycle bin (restorable for 30 days) and disconnects anyone editing it."""
    access.require(db, doc_id, *c, minimum="owner")
    db.execute("UPDATE documents SET deleted_at = ? WHERE id = ?", (time.time(), doc_id))
    db.commit()
    await refresh_access(doc_id)
    return {"ok": True}


# ───────────────────────── sharing ─────────────────────────
ROLE_VERB = {"viewer": "fill out", "editor": "edit", "manager": "manage"}
ROLE_ACCESS = {"viewer": "view", "editor": "edit", "manager": "manage"}
class ShareEntry(BaseModel):
    email: str
    role: Literal["viewer", "editor", "manager"]


class SharingIn(BaseModel):
    link_access: Literal["restricted", "anyone", "password"]
    link_role: Literal["viewer", "editor"] = "viewer"
    password: str | None = Field(None, min_length=4, max_length=200)
    shares: list[ShareEntry] = []


def sharing_view(db, doc) -> dict:
    rows = db.execute(
        """SELECT s.email, s.role, u.name FROM shares s LEFT JOIN users u ON u.email = s.email
           WHERE s.doc_id = ? ORDER BY s.created_at""",
        (doc["id"],),
    ).fetchall()
    return {
        "link_access": doc["link_access"],
        "link_role": doc["link_role"],
        "has_password": bool(doc["link_password_hash"]),
        "shares": [{"email": r["email"], "role": r["role"], "name": r["name"]} for r in rows],
    }


@router.get("/docs/{doc_id}/sharing")
def get_sharing(doc_id: str, c=Depends(ctx), db=Depends(get_db)):
    doc, _ = access.require(db, doc_id, *c, minimum="manager")
    return sharing_view(db, doc)


@router.put("/docs/{doc_id}/sharing")
async def put_sharing(doc_id: str, body: SharingIn, c=Depends(ctx), db=Depends(get_db)):
    doc, acc = access.require(db, doc_id, *c, minimum="manager")
    if doc["zk"]:
        raise HTTPException(409, {"code": "zk_unsupported", "message": "An encrypted document is shared with its own sharing dialog (people who have encryption on). Links aren't possible."})
    owner_email = db.execute("SELECT email FROM users WHERE id = ?", (doc["owner_id"],)).fetchone()["email"]
    if doc["kind"] == "form":
        body.link_role = "viewer"   # links on a form only ever let people fill it out
    pw_hash = doc["link_password_hash"]
    if body.link_access == "password":
        if body.password:
            pw_hash = hash_password(body.password)
        elif not pw_hash:
            raise HTTPException(422, "Set a password to protect this link")
    seen: dict[str, str] = {}
    for s in body.shares:
        email = s.email.strip().lower()
        if not EMAIL_RE.match(email):
            raise HTTPException(422, f"'{s.email}' is not a valid email address")
        if email == owner_email:
            continue   # the owner always has access and is not on the list
        seen[email] = s.role
    if acc.role == "manager":
        seen[acc.user["email"]] = "manager"   # a manager saving the list can never lock themselves out by accident
    db.execute(
        "UPDATE documents SET link_access = ?, link_role = ?, link_password_hash = ? WHERE id = ?",
        (body.link_access, body.link_role, pw_hash, doc_id),
    )
    before = {r["email"] for r in db.execute("SELECT email FROM shares WHERE doc_id = ?", (doc_id,))}
    db.execute("DELETE FROM shares WHERE doc_id = ?", (doc_id,))
    now = time.time()
    db.executemany(
        "INSERT INTO shares (doc_id, email, role, created_at) VALUES (?,?,?,?)",
        [(doc_id, e, r, now) for e, r in seen.items()],
    )
    from . import notifications
    for email in set(seen) - before:   # tell people who were just given access
        target = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if target:
            notifications.add(db, target["id"], "share", doc, acc.user["name"], (f"invited you to {ROLE_VERB[seen[email]]} the form" if doc["kind"] == "form" else f"gave you {ROLE_ACCESS[seen[email]]} access"))
    db.commit()
    await refresh_access(doc_id)  # kick/refresh anyone connected whose permission just changed
    return sharing_view(db, db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone())


class UnlockIn(BaseModel):
    password: str


@router.post("/docs/{doc_id}/unlock")
def unlock(doc_id: str, body: UnlockIn, request: Request, db=Depends(get_db)):
    doc = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if not doc or doc["link_access"] != "password" or not doc["link_password_hash"]:
        raise HTTPException(404, "This document isn't password protected")
    if not unlock_limiter.allow(f"{request.client.host if request.client else '?'}:{doc_id}"):
        raise HTTPException(429, "Too many attempts. Try again in a minute.")
    if not check_password(body.password, doc["link_password_hash"]):
        raise HTTPException(403, "Wrong password")
    return {"token": make_doc_token(doc_id)}


# ───────────────────────── images ─────────────────────────
MAX_IMAGE = 12 * 1024 * 1024
SIGNATURES = [
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
]


def sniff(data: bytes) -> str | None:
    for sig, ext in SIGNATURES:
        if data.startswith(sig):
            return ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def store_image(db, doc, doc_id: str, data: bytes, ext: str, who: str) -> str:
    """Save a picture, or reuse the copy the owner already has when the bytes are identical (it then costs no extra storage)."""
    h = hashlib.sha256(data).hexdigest()
    row = db.execute("SELECT name FROM uploads WHERE owner_id = ? AND ((hash = ? AND size = ?) OR orig_hash = ?)", (doc["owner_id"], h, len(data), h)).fetchone()   # (orig_hash: the same file that was later made smaller)
    if row and (UPLOAD_DIR / row["name"]).exists():
        db.execute("INSERT OR IGNORE INTO upload_refs (name, doc_id) VALUES (?,?)", (row["name"], doc_id))
        db.commit()
        return row["name"]
    quota.check(db, doc["owner_id"], len(data), who)
    name = f"{uuid.uuid4().hex}.{ext}"
    (UPLOAD_DIR / name).write_bytes(data)
    db.execute("INSERT INTO uploads (name, doc_id, owner_id, size, created_at, hash) VALUES (?,?,?,?,?,?)", (name, doc_id, doc["owner_id"], len(data), time.time(), h))
    db.execute("INSERT OR IGNORE INTO upload_refs (name, doc_id) VALUES (?,?)", (name, doc_id))
    db.commit()
    return name


@router.post("/docs/{doc_id}/images")
async def upload_image(doc_id: str, file: UploadFile = File(...), c=Depends(ctx), db=Depends(get_db)):
    data = await file.read(MAX_IMAGE + 1)
    if len(data) > MAX_IMAGE:
        raise HTTPException(413, "Image is larger than 12 MB")
    ext = sniff(data)
    if not ext:
        raise HTTPException(415, "Only PNG, JPEG, GIF and WebP images are supported")
    doc, _acc = access.require(db, doc_id, *c, minimum="editor")
    name = store_image(db, doc, doc_id, data, ext, "The document's owner" if _acc.role != "owner" else "Your account")
    return {"url": f"/api/images/{name}"}


class ImportImage(BaseModel):
    url: str = Field(max_length=2000)


import_limiter = RateLimiter(40, 60)


async def assert_public(url: str) -> None:
    """Only ever fetch from the public internet: never loopback, private, link-local or reserved addresses. KOKO_IMPORT_ALLOW_PRIVATE=1 lifts this (for tests only)."""
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password:
        raise HTTPException(422, "That isn't a usable web address")
    if os.environ.get("KOKO_IMPORT_ALLOW_PRIVATE") == "1":
        return
    try:
        infos = await asyncio.to_thread(socket.getaddrinfo, u.hostname, u.port or (443 if u.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise HTTPException(422, "Couldn't find that address")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_multicast:
            raise HTTPException(422, "That address isn't on the public internet")


async def fetch_public_image(url: str) -> bytes:
    """Download a picture from the public internet (redirects followed by hand so every hop is checked; size capped)."""
    url, data = url.strip(), b""
    async with httpx.AsyncClient(follow_redirects=False, timeout=httpx.Timeout(12.0, connect=6.0), headers={"User-Agent": "Mozilla/5.0 (compatible; KokoDocs image import)", "Accept": "image/*"}) as client:
        for _hop in range(4):   # follow redirects by hand so every hop is checked
            await assert_public(url)
            async with client.stream("GET", url) as r:
                if r.is_redirect and r.headers.get("location"):
                    url = urljoin(url, r.headers["location"])
                    continue
                if r.status_code != 200:
                    raise HTTPException(422, f"The picture couldn't be fetched (the other site said {r.status_code})")
                if int(r.headers.get("content-length") or 0) > MAX_IMAGE:
                    raise HTTPException(413, "Image is larger than 12 MB")
                async for chunk in r.aiter_bytes():
                    data += chunk
                    if len(data) > MAX_IMAGE:
                        raise HTTPException(413, "Image is larger than 12 MB")
            break
        else:
            raise HTTPException(422, "Too many redirects")
    return data


@router.post("/docs/{doc_id}/images/import")
async def import_image(doc_id: str, body: ImportImage, request: Request, c=Depends(ctx), db=Depends(get_db)):
    """Pasting from Google Docs, a web page or Word brings pictures as links to someone else's server. Fetch the picture and keep a copy
    with the document, so it still shows when the original link expires or needs a login."""
    doc, acc = access.require(db, doc_id, *c, minimum="editor")
    who = acc.user["id"] if acc.user else (request.client.host if request.client else "?")
    if not import_limiter.allow(f"imgimport:{who}"):
        raise HTTPException(429, "Too many pictures at once. Try again in a minute.")
    data = await fetch_public_image(body.url)
    ext = sniff(data)
    if not ext:
        raise HTTPException(415, "That link isn't a PNG, JPEG, GIF or WebP picture")
    name = store_image(db, doc, doc_id, data, ext, "The document's owner" if acc.role != "owner" else "Your account")
    return {"url": f"/api/images/{name}"}


@router.get("/images/{name}")
def get_image(name: str, db=Depends(get_db)):
    if not re.fullmatch(r"[0-9a-f]{32}\.(png|jpg|gif|webp)", name):
        raise HTTPException(404)
    path = UPLOAD_DIR / name
    if not path.exists():   # a merged duplicate: its address now points at the copy that was kept
        row = db.execute("SELECT target FROM image_aliases WHERE name = ?", (name,)).fetchone()
        path = UPLOAD_DIR / row["target"] if row else path
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"})


# ───────────────────────── proofreading ─────────────────────────
class Block(BaseModel):
    id: int
    text: str = Field(max_length=20000)


class ProofIn(BaseModel):
    blocks: list[Block] = Field(max_length=2000)
    language: str = Field("en-US", pattern=r"^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$")


@router.post("/docs/{doc_id}/proofread")
async def proofread(doc_id: str, body: ProofIn, request: Request, c=Depends(ctx), db=Depends(get_db)):
    """Needs access to the document, the same way everything else does: a signed-in person with access, or someone with the link (or its
    password token). So people editing through a link, with no account, can proofread, and strangers can't use this server's proofreader."""
    doc, acc = access.require(db, doc_id, *c)
    access.zk_unsupported(doc, "Proofreading")
    who = acc.user["id"] if acc.user else (request.client.host if request.client else "?")
    if not proofread_limiter.allow(f"proof:{who}"):
        raise HTTPException(429, "Slow down: too many proofreading requests. Try again in a minute.")
    return {"issues": await check_blocks([b.model_dump() for b in body.blocks], body.language)}


# ───────────────────────── voice typing ─────────────────────────
@router.get("/stt/status")
def stt_status(db=Depends(get_db)):
    return stt.status(db)


@router.post("/docs/{doc_id}/transcribe/draft")
async def transcribe_draft(doc_id: str, request: Request, file: UploadFile = File(...), language: str | None = None, c=Depends(ctx), db=Depends(get_db)):
    """A rough live preview of a recording still in progress, from the small local model. The real text comes from /transcribe."""
    doc, acc = access.require(db, doc_id, *c, minimum="editor")
    who = acc.user["id"] if acc.user else (request.client.host if request.client else "?")
    if not draft_limiter.allow(f"draft:{who}"):
        raise HTTPException(429, "Too many previews")
    audio = await file.read(stt.MAX_BYTES + 1)
    if len(audio) < 1000:
        return {"text": ""}
    try:
        return {"text": await stt.draft(audio, language, db)}
    except stt.STTError as e:
        raise HTTPException(e.status, str(e))


@router.post("/docs/{doc_id}/transcribe")
async def transcribe(doc_id: str, request: Request, file: UploadFile = File(...), language: str | None = None, c=Depends(ctx), db=Depends(get_db)):
    """Turn a short recording into text. Requires edit access to the document (so strangers can't spend your API credits)."""
    doc, acc = access.require(db, doc_id, *c, minimum="editor")
    who = acc.user["id"] if acc.user else (request.client.host if request.client else "?")
    if not stt_limiter.allow(f"stt:{who}"):
        raise HTTPException(429, "Slow down: too many voice requests. Try again in a minute.")
    audio = await file.read(stt.MAX_BYTES + 1)
    if len(audio) < 1000:
        return {"text": ""}
    try:
        text = await stt.transcribe(audio, file.filename or "speech.wav", file.content_type or "audio/wav", language, db)
    except stt.STTError as e:
        raise HTTPException(e.status, str(e))
    return {"text": text}
