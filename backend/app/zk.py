"""Zero-knowledge encryption (off by default, switched on per account).

The server never sees a password, a key or a word of an encrypted document. Everything below only stores and relays
things the browser has already encrypted:

  account    the browser stretches the password (Argon2id) into a login secret, which is what the server checks, and a
             wrapping key, which never leaves the browser. A random master key is stored only wrapped by that key (and
             by the recovery key), and so is the private half of the person's sharing keypair. The public half is stored
             in the clear so others can share with them.
  document   each encrypted document has its own random key. Every person who may open it has a copy of that key sealed
             to their public key (zk_grants). Edits are stored as encrypted updates (zk_updates) with an occasional
             encrypted snapshot (zk_checkpoints) so the log stays short.

What the server still knows: who has an account, which documents exist, their kind, size and timing, and who they are shared
with. It cannot read titles, content, comments or keys. See README ("Zero-knowledge encryption").
"""
import base64
import hashlib
import json
import re
import time
import uuid
from typing import Literal

import jwt
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from . import access
from .collab import evict_room, flush, rooms
from .db import UPLOAD_DIR, get_db
from .routes import COLORS, EMAIL_RE, ctx, fetch_public_image, import_limiter, must_user, public_user, sniff
from .security import SECRET, RateLimiter, check_password, hash_password, make_token

router = APIRouter(prefix="/api")
prelogin_limiter = RateLimiter(60, 60)
guess_limiter = RateLimiter(10, 60)
MAX_B64 = 200_000        # keys and short strings
MAX_BLOB_B64 = 40_000_000   # a whole encrypted document state

B64 = Field(max_length=MAX_B64)


def unb64(s: str) -> bytes:
    try:
        s = s.replace("+", "-").replace("/", "_")
        return base64.b64decode(s + "=" * (-len(s) % 4), altchars=b"-_", validate=True)
    except Exception:
        raise HTTPException(422, "That isn't valid encoded data")


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def zk_user(user) -> bool:
    return bool(user["zk_enabled"])


def must_zk(user=Depends(must_user)):
    if not user["zk_enabled"]:
        raise HTTPException(409, {"code": "zk_off", "message": "Encryption isn't turned on for this account"})
    return user


unsupported = access.zk_unsupported


# ───────────────────────── signing in ─────────────────────────
@router.get("/auth/prelogin")
def prelogin(email: str, request: Request, db=Depends(get_db)):
    """What the browser needs before it can sign in: whether this account uses encryption, and the salt for its password."""
    if not prelogin_limiter.allow(request.client.host if request.client else "?"):
        raise HTTPException(429, "Too many attempts. Try again in a minute.")
    u = db.execute("SELECT zk_enabled, zk_salt, zk_params FROM users WHERE email = ?", (email.strip().lower(),)).fetchone()
    if u and u["zk_enabled"]:
        return {"zk": True, "salt": u["zk_salt"], "params": json.loads(u["zk_params"] or "{}")}
    return {"zk": False}


def keys_view(u) -> dict:
    return {"salt": u["zk_salt"], "params": json.loads(u["zk_params"] or "{}"), "master_wrapped": u["zk_master_wrapped"], "priv_wrapped": u["zk_priv_wrapped"],
            "pub": u["zk_pub"], "recovery_wrapped": u["zk_recovery_wrapped"]}


@router.get("/zk/keys")
def get_keys(user=Depends(must_zk)):
    return keys_view(user)


@router.get("/zk/status")
def status(user=Depends(must_user), db=Depends(get_db)):
    """Counts for the settings page: what is plain and what is encrypted."""
    own = db.execute("SELECT zk, kind, link_access, COUNT(*) AS n FROM documents WHERE owner_id = ? GROUP BY zk, kind, link_access", (user["id"],)).fetchall()
    plain = sum(r["n"] for r in own if not r["zk"])
    blocked = sum(r["n"] for r in own if not r["zk"] and (r["kind"] == "form" or r["link_access"] != "restricted"))
    enc = sum(r["n"] for r in own if r["zk"])
    shared = db.execute("SELECT COUNT(*) AS n FROM shares s JOIN documents d ON d.id = s.doc_id WHERE s.email = ? AND d.zk = 1 AND d.deleted_at IS NULL", (user["email"],)).fetchone()["n"]
    return {"enabled": bool(user["zk_enabled"]), "since": user["zk_at"], "plain": plain, "plain_blocked": blocked, "encrypted": enc, "shared_encrypted": shared, "has_password": bool(user["pw_set"])}


# ───────────────────────── turning it on and off ─────────────────────────
class Keys(BaseModel):
    salt: str = B64
    params: dict
    auth: str = Field(min_length=20, max_length=200)   # the login secret derived from the password: what the server now checks
    master_wrapped: str = B64
    priv_wrapped: str = B64
    pub: str = Field(min_length=20, max_length=200)
    recovery_wrapped: str = B64


def check_params(p: dict) -> None:
    m, t, par = p.get("m"), p.get("t"), p.get("p")
    if not (isinstance(m, int) and isinstance(t, int) and isinstance(par, int)) or not (19456 <= m <= 1048576 and 1 <= t <= 10 and 1 <= par <= 8):
        raise HTTPException(422, "Those password-stretching settings aren't allowed")


class EnableIn(Keys):
    password: str   # the current password, once, to prove it is really them (the server holds its hash until now)


@router.post("/zk/enable")
def enable(b: EnableIn, user=Depends(must_user), db=Depends(get_db)):
    if user["zk_enabled"]:
        raise HTTPException(409, "Encryption is already on")
    if not user["pw_set"]:
        raise HTTPException(409, {"code": "no_password", "message": "Set a password first (Settings, Security). Encryption keys are protected by it."})
    if not guess_limiter.allow("zk-enable:" + user["id"]):
        raise HTTPException(429, "Too many attempts. Try again in a minute.")
    if not check_password(b.password, user["password_hash"]):
        raise HTTPException(400, "Your password is incorrect")
    check_params(b.params)
    db.execute("""UPDATE users SET zk_enabled = 1, zk_salt = ?, zk_params = ?, zk_master_wrapped = ?, zk_priv_wrapped = ?, zk_pub = ?, zk_recovery_wrapped = ?, zk_at = ?, password_hash = ? WHERE id = ?""",
               (b.salt, json.dumps(b.params), b.master_wrapped, b.priv_wrapped, b.pub, b.recovery_wrapped, time.time(), hash_password(b.auth), user["id"]))
    db.commit()
    return {"ok": True}


class DisableIn(BaseModel):
    auth: str = Field(max_length=200)        # proves the password (the login secret)
    password: str = Field(min_length=8, max_length=200)   # becomes the ordinary password again


@router.post("/zk/disable")
def disable(b: DisableIn, user=Depends(must_zk), db=Depends(get_db)):
    if not guess_limiter.allow("zk-disable:" + user["id"]):
        raise HTTPException(429, "Too many attempts. Try again in a minute.")
    if not check_password(b.auth, user["password_hash"]):
        raise HTTPException(400, "Your password is incorrect")
    left = db.execute("SELECT COUNT(*) AS n FROM documents WHERE owner_id = ? AND zk = 1", (user["id"],)).fetchone()["n"]
    if left:
        raise HTTPException(409, {"code": "zk_docs_left", "message": f"{left} encrypted document{'s' if left != 1 else ''} still need to be decrypted first.", "left": left})
    db.execute("DELETE FROM zk_grants WHERE email = ?", (user["email"],))   # the keys others sealed to them stop being usable once the private key is gone
    db.execute("""UPDATE users SET zk_enabled = 0, zk_salt = NULL, zk_params = NULL, zk_master_wrapped = NULL, zk_priv_wrapped = NULL, zk_pub = NULL, zk_recovery_wrapped = NULL, zk_at = NULL, password_hash = ? WHERE id = ?""",
               (hash_password(b.password), user["id"]))
    db.commit()
    return {"ok": True}


class PasswordIn(BaseModel):
    current: str = Field(max_length=200)     # the current login secret
    salt: str = B64
    params: dict
    auth: str = Field(min_length=20, max_length=200)   # the new login secret
    master_wrapped: str = B64
    code: str = ""


@router.post("/zk/password")
def change_password(b: PasswordIn, user=Depends(must_zk), db=Depends(get_db)):
    """A new password only re-wraps the master key. Nothing is re-encrypted and nobody's shares change."""
    from .authx import mfa_limiter, verify_second_factor
    if not mfa_limiter.allow("pw:" + user["id"]):
        raise HTTPException(429, "Too many attempts. Try again in a minute.")
    if not check_password(b.current, user["password_hash"]):
        raise HTTPException(400, "Your current password is incorrect")
    if user["totp_enabled"] and not verify_second_factor(db, user, b.code):
        raise HTTPException(400, "That two-factor code didn't work")
    check_params(b.params)
    db.execute("UPDATE users SET zk_salt = ?, zk_params = ?, zk_master_wrapped = ?, password_hash = ? WHERE id = ?", (b.salt, json.dumps(b.params), b.master_wrapped, hash_password(b.auth), user["id"]))
    db.commit()
    return {"ok": True}


class RecoveryIn(BaseModel):
    auth: str = Field(max_length=200)
    recovery_wrapped: str = B64


@router.put("/zk/recovery")
def set_recovery(b: RecoveryIn, user=Depends(must_zk), db=Depends(get_db)):
    if not check_password(b.auth, user["password_hash"]):
        raise HTTPException(400, "Your password is incorrect")
    db.execute("UPDATE users SET zk_recovery_wrapped = ? WHERE id = ?", (b.recovery_wrapped, user["id"]))
    db.commit()
    return {"ok": True}


# ───────────────────────── a forgotten password ─────────────────────────
def make_reset_token(uid: str) -> str:
    return jwt.encode({"sub": uid, "typ": "zkreset", "exp": time.time() + 15 * 60}, SECRET, "HS256")


def read_reset_token(t: str | None) -> str | None:
    try:
        p = jwt.decode(t or "", SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return p["sub"] if p.get("typ") == "zkreset" else None


class ResetFinish(BaseModel):
    token: str
    salt: str = B64
    params: dict
    auth: str = Field(min_length=20, max_length=200)
    master_wrapped: str = B64
    recovery_wrapped: str = B64


@router.post("/zk/reset/finish")
def reset_finish(b: ResetFinish, db=Depends(get_db)):
    """After the emailed code: the browser unwrapped the master key with the recovery key and wrapped it again under the new password."""
    uid = read_reset_token(b.token)
    user = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone() if uid else None
    if not user or user["disabled"] or not user["zk_enabled"]:
        raise HTTPException(400, "That reset expired. Start again.")
    check_params(b.params)
    db.execute("UPDATE users SET zk_salt = ?, zk_params = ?, zk_master_wrapped = ?, zk_recovery_wrapped = ?, password_hash = ?, pw_set = 1 WHERE id = ?",
               (b.salt, json.dumps(b.params), b.master_wrapped, b.recovery_wrapped, hash_password(b.auth), user["id"]))
    db.commit()
    return {"ok": True}


class ResetDestroy(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=200)
    confirm: Literal["DELETE"]


@router.post("/zk/reset/destroy")
async def reset_destroy(b: ResetDestroy, db=Depends(get_db)):
    """No recovery key: the encrypted documents can never be opened again. Delete them and give the account an ordinary password."""
    uid = read_reset_token(b.token)
    user = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone() if uid else None
    if not user or user["disabled"] or not user["zk_enabled"]:
        raise HTTPException(400, "That reset expired. Start again.")
    ids = [r["id"] for r in db.execute("SELECT id FROM documents WHERE owner_id = ? AND zk = 1", (user["id"],))]
    for i in ids:
        db.execute("DELETE FROM documents WHERE id = ?", (i,))
    db.execute("DELETE FROM zk_grants WHERE email = ?", (user["email"],))
    db.execute("""UPDATE users SET zk_enabled = 0, zk_salt = NULL, zk_params = NULL, zk_master_wrapped = NULL, zk_priv_wrapped = NULL, zk_pub = NULL, zk_recovery_wrapped = NULL, zk_at = NULL,
                  password_hash = ?, pw_set = 1 WHERE id = ?""", (hash_password(b.password), user["id"]))
    db.commit()
    for i in ids:
        await evict_room(i)
    return {"ok": True, "deleted": len(ids)}


# ───────────────────────── public keys ─────────────────────────
@router.get("/zk/pubkey")
def pubkey(email: str, user=Depends(must_user), db=Depends(get_db)):
    u = db.execute("SELECT name, email, zk_pub, zk_enabled FROM users WHERE email = ?", (email.strip().lower(),)).fetchone()
    if not u or not u["zk_enabled"]:
        raise HTTPException(404, {"code": "zk_not_enabled", "message": "That person hasn't turned on encryption (or has no account), so an encrypted document can't be shared with them."})
    return {"email": u["email"], "name": u["name"], "pub": u["zk_pub"]}


# ───────────────────────── documents ─────────────────────────
class NewDoc(BaseModel):
    id: str = Field(pattern=r"^[0-9a-f]{16}$")   # chosen by the browser, because the title is encrypted bound to the document's id
    kind: Literal["doc", "sheet", "slides", "wiki", "board"] = "doc"
    folder_id: str | None = None
    title_enc: str = B64
    sealed: str = B64    # the document key, sealed to the creator's public key


@router.post("/zk/docs")
def create_doc(b: NewDoc, user=Depends(must_zk), db=Depends(get_db)):
    from . import quota
    from .routes import doc_summary
    quota.check(db, user["id"], 0)
    did, now = b.id, time.time()
    if db.execute("SELECT 1 FROM documents WHERE id = ?", (did,)).fetchone():
        raise HTTPException(409, "That document id is taken. Try again.")
    folder = b.folder_id
    if folder and not db.execute("SELECT 1 FROM folders WHERE id = ? AND owner_id = ?", (folder, user["id"])).fetchone():
        folder = None
    db.execute("INSERT INTO documents (id, owner_id, title, folder_id, kind, created_at, updated_at, zk, zk_title) VALUES (?,?,?,?,?,?,?,1,?)",
               (did, user["id"], "Encrypted document", folder, b.kind, now, now, b.title_enc))
    db.execute("INSERT INTO zk_grants (doc_id, email, sealed, by_email, created_at) VALUES (?,?,?,?,?)", (did, user["email"], b.sealed, user["email"], now))
    db.commit()
    d = db.execute("SELECT * FROM documents WHERE id = ?", (did,)).fetchone()
    return {**doc_summary(d, "owner", user["name"]), "zk": True, "zk_title": b.title_enc, "zk_sealed": b.sealed}


def newest_id(db, doc_id: str) -> int:
    """The newest update number the document has: in a snapshot or after it."""
    u = db.execute("SELECT COALESCE(MAX(id), 0) AS m FROM zk_updates WHERE doc_id = ?", (doc_id,)).fetchone()["m"]
    c = db.execute("SELECT upto FROM zk_checkpoints WHERE doc_id = ?", (doc_id,)).fetchone()
    return max(u, c["upto"] if c else 0)


def own_doc(db, doc_id: str, user, c) -> "sqlite3.Row":  # noqa: F821
    doc, acc = access.require(db, doc_id, *c, minimum="owner")
    return doc


@router.get("/zk/docs/{doc_id}/plain")
async def plain_state(doc_id: str, c=Depends(ctx), user=Depends(must_zk), db=Depends(get_db)):
    """The owner's plain document, to be encrypted in their browser."""
    doc = own_doc(db, doc_id, user, c)
    if doc["zk"]:
        raise HTTPException(409, "That document is already encrypted")
    room = rooms.get(doc_id)
    if room:
        await flush(room)
    doc = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    why = None
    if doc["kind"] == "form":
        why = "Forms can't be encrypted yet: people fill them in without an account, so the server has to be able to read them."
    elif doc["link_access"] != "restricted":
        why = "This document can be opened with a link. Turn the link off first: an encrypted document can only be opened by the people it is shared with."
    return {"ydoc": b64(bytes(doc["ydoc"])) if doc["ydoc"] else None, "title": doc["title"], "kind": doc["kind"], "updated_at": doc["updated_at"], "blocked": why,
            "has_images": bool(db.execute("SELECT 1 FROM upload_refs WHERE doc_id = ? LIMIT 1", (doc_id,)).fetchone())}


def move_comments(db, doc_id: str, comments: dict[str, dict[str, str]]) -> None:
    """The browser re-encrypted (or decrypted) every comment; they must be exactly the ones there are, so none is left in the old form."""
    have = {r["id"] for r in db.execute("SELECT id FROM comments WHERE doc_id = ?", (doc_id,))}
    if set(comments) != have:
        raise HTTPException(409, {"code": "changed", "message": "A comment was added while the document was being converted. Try again."})
    for cid, c in comments.items():
        db.execute("UPDATE comments SET body = ?, quote = ? WHERE id = ? AND doc_id = ?", (str(c.get("body", ""))[:12000], str(c.get("quote", ""))[:1600], cid, doc_id))


class EncryptIn(BaseModel):
    comments: dict[str, dict[str, str]] = Field(default_factory=dict)   # {id: {body, quote}} encrypted under the document's key
    title_enc: str = B64
    sealed: str = B64
    checkpoint: str = Field(max_length=MAX_BLOB_B64)   # the whole document, encrypted
    expect_updated_at: float


@router.post("/zk/docs/{doc_id}/encrypt")
async def encrypt_doc(doc_id: str, b: EncryptIn, c=Depends(ctx), user=Depends(must_zk), db=Depends(get_db)):
    doc = own_doc(db, doc_id, user, c)
    if doc["zk"]:
        raise HTTPException(409, "That document is already encrypted")
    if doc["kind"] == "form" or doc["link_access"] != "restricted":
        raise HTTPException(409, "That document can't be encrypted (a form, or open to anyone with a link)")
    room = rooms.get(doc_id)
    if room:
        await flush(room)
    doc = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if abs(doc["updated_at"] - b.expect_updated_at) > 1e-6:
        raise HTTPException(409, {"code": "changed", "message": "Someone changed the document while it was being encrypted. Try again."})
    db.execute("PRAGMA secure_delete = ON")   # what is removed or replaced below is overwritten, not just unlinked, so the plain text doesn't linger in the file
    move_comments(db, doc_id, b.comments)
    now = time.time()
    db.execute("DELETE FROM shares WHERE doc_id = ?", (doc_id,))   # people it was shared with have no key yet: share it again once it is encrypted
    db.execute("UPDATE documents SET zk = 1, zk_title = ?, title = 'Encrypted document', ydoc = NULL, updated_at = ? WHERE id = ?", (b.title_enc, now, doc_id))
    db.execute("DELETE FROM zk_updates WHERE doc_id = ?", (doc_id,))
    db.execute("INSERT OR REPLACE INTO zk_checkpoints (doc_id, upto, blob, created_at) VALUES (?,?,?,?)", (doc_id, 0, unb64(b.checkpoint), now))
    db.execute("DELETE FROM zk_grants WHERE doc_id = ?", (doc_id,))
    db.execute("INSERT INTO zk_grants (doc_id, email, sealed, by_email, created_at) VALUES (?,?,?,?,?)", (doc_id, user["email"], b.sealed, user["email"], now))
    drop_plain_images(db, doc_id)   # the browser re-stored the pictures encrypted
    for t in ("doc_fts", "versions", "ai_conversations"):   # everything the server had derived from the plain text goes
        try:
            db.execute(f"DELETE FROM {t} WHERE doc_id = ?", (doc_id,))
        except Exception:
            pass
    db.commit()
    try:
        db.execute("PRAGMA wal_checkpoint(TRUNCATE)")   # old page images in the write-ahead log would still hold the plain text
    except Exception:
        pass
    await evict_room(doc_id)
    return {"ok": True}


@router.get("/zk/docs/{doc_id}/log")
def get_log(doc_id: str, c=Depends(ctx), db=Depends(get_db)):
    """The encrypted history: the latest snapshot and the updates after it."""
    doc, _ = access.require(db, doc_id, *c)
    if not doc["zk"]:
        raise HTTPException(409, "That document isn't encrypted")
    cp = db.execute("SELECT upto, blob FROM zk_checkpoints WHERE doc_id = ?", (doc_id,)).fetchone()
    ups = db.execute("SELECT id, blob FROM zk_updates WHERE doc_id = ? AND id > ? ORDER BY id", (doc_id, cp["upto"] if cp else 0)).fetchall()
    return {"checkpoint": b64(bytes(cp["blob"])) if cp else None, "upto": cp["upto"] if cp else 0, "updates": [{"id": u["id"], "blob": b64(bytes(u["blob"]))} for u in ups]}


class DecryptIn(BaseModel):
    comments: dict[str, dict[str, str]] = Field(default_factory=dict)   # {id: {body, quote}} in plain text
    ydoc: str = Field(max_length=MAX_BLOB_B64)    # the plain document state
    title: str = Field(max_length=200)
    last_id: int       # the newest update this state includes (a newer one means someone edited meanwhile)


@router.post("/zk/docs/{doc_id}/decrypt")
async def decrypt_doc(doc_id: str, b: DecryptIn, c=Depends(ctx), user=Depends(must_zk), db=Depends(get_db)):
    doc = own_doc(db, doc_id, user, c)
    if not doc["zk"]:
        raise HTTPException(409, "That document isn't encrypted")
    if newest_id(db, doc_id) > b.last_id:
        raise HTTPException(409, {"code": "changed", "message": "Someone edited the document while it was being decrypted. Try again."})
    state = unb64(b.ydoc)
    move_comments(db, doc_id, b.comments)
    now = time.time()
    db.execute("UPDATE documents SET zk = 0, zk_title = NULL, title = ?, ydoc = ?, updated_at = ? WHERE id = ?", (b.title.strip() or "Untitled document", state, now, doc_id))
    db.execute("DELETE FROM zk_updates WHERE doc_id = ?", (doc_id,))
    db.execute("DELETE FROM zk_checkpoints WHERE doc_id = ?", (doc_id,))
    db.execute("DELETE FROM zk_grants WHERE doc_id = ?", (doc_id,))
    try:   # Koko conversations were encrypted with each person's own key: they can't be read any more
        db.execute("DELETE FROM ai_conversations WHERE doc_id = ?", (doc_id,))
    except Exception:
        pass
    drop_zk_images(db, doc_id, set())   # the browser re-stored the pictures unencrypted
    db.commit()
    try:
        from . import searchindex
        searchindex.index_doc(db, doc_id, state)
        db.commit()
    except Exception:
        pass
    await evict_room(doc_id)
    return {"ok": True}


# ───────────────────────── sharing ─────────────────────────
class ShareEntry(BaseModel):
    email: str
    role: Literal["viewer", "editor", "manager"]
    sealed: str | None = Field(None, max_length=MAX_B64)   # the document key sealed to this person (needed the first time)


class ShareIn(BaseModel):
    shares: list[ShareEntry] = Field(max_length=200)


@router.put("/zk/docs/{doc_id}/sharing")
async def put_sharing(doc_id: str, b: ShareIn, c=Depends(ctx), user=Depends(must_zk), db=Depends(get_db)):
    from .routes import ROLE_ACCESS, sharing_view
    doc, acc = access.require(db, doc_id, *c, minimum="manager")
    if not doc["zk"]:
        raise HTTPException(409, "That document isn't encrypted")
    owner_email = db.execute("SELECT email FROM users WHERE id = ?", (doc["owner_id"],)).fetchone()["email"]
    have = {r["email"] for r in db.execute("SELECT email FROM zk_grants WHERE doc_id = ?", (doc_id,))}
    wanted: dict[str, str] = {}
    new_grants: dict[str, str] = {}
    for s in b.shares:
        email = s.email.strip().lower()
        if not EMAIL_RE.match(email):
            raise HTTPException(422, f"'{s.email}' is not a valid email address")
        if email == owner_email:
            continue
        target = db.execute("SELECT zk_enabled FROM users WHERE email = ?", (email,)).fetchone()
        if not target or not target["zk_enabled"]:
            raise HTTPException(422, {"code": "zk_not_enabled", "message": f"{email} hasn't turned on encryption (or has no account), so this document can't be shared with them."})
        if email not in have:
            if not s.sealed:
                raise HTTPException(422, f"No key was provided for {email}")
            new_grants[email] = s.sealed
        wanted[email] = s.role
    if acc.role == "manager":
        wanted[acc.user["email"]] = "manager"
    before = {r["email"] for r in db.execute("SELECT email FROM shares WHERE doc_id = ?", (doc_id,))}
    removed = sorted(before - set(wanted))
    now = time.time()
    db.execute("DELETE FROM shares WHERE doc_id = ?", (doc_id,))
    db.executemany("INSERT INTO shares (doc_id, email, role, created_at) VALUES (?,?,?,?)", [(doc_id, e, r, now) for e, r in wanted.items()])
    for e in removed:
        db.execute("DELETE FROM zk_grants WHERE doc_id = ? AND email = ?", (doc_id, e))
    for e, sealed in new_grants.items():
        db.execute("INSERT OR REPLACE INTO zk_grants (doc_id, email, sealed, by_email, created_at) VALUES (?,?,?,?,?)", (doc_id, e, sealed, acc.user["email"], now))
    from . import notifications
    for email in set(wanted) - before:
        target = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if target:
            notifications.add(db, target["id"], "share", doc, acc.user["name"], f"gave you {ROLE_ACCESS[wanted[email]]} access to an encrypted document")
    db.commit()
    from .collab import refresh_access
    await refresh_access(doc_id)
    return {**sharing_view(db, db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()), "removed": removed}


class RotateIn(BaseModel):
    title_enc: str = B64
    checkpoint: str = Field(max_length=MAX_BLOB_B64)     # the whole document, encrypted under the new key
    grants: dict[str, str]                                   # email -> the new key sealed to them (everyone who keeps access, the owner included)
    last_id: int                                              # the newest update the new snapshot includes
    images: list[str] = Field(default_factory=list, max_length=500)   # the pictures stored again under the new key (names); the old ones go
    comments: dict[str, dict[str, str]] = Field(default_factory=dict)   # every comment, re-encrypted under the new key: {id: {body, quote}}


@router.post("/zk/docs/{doc_id}/rotate")
async def rotate(doc_id: str, b: RotateIn, c=Depends(ctx), user=Depends(must_zk), db=Depends(get_db)):
    """After someone was removed: a new key for the document, so what they could still download is useless from now on.
    They keep whatever they already saw; this protects what is written afterwards."""
    doc, acc = access.require(db, doc_id, *c, minimum="manager")
    if not doc["zk"]:
        raise HTTPException(409, "That document isn't encrypted")
    newest = newest_id(db, doc_id)
    if newest > b.last_id:
        raise HTTPException(409, {"code": "changed", "message": "Someone edited the document while its key was changing. Try again."})
    allowed = {r["email"] for r in db.execute("SELECT email FROM zk_grants WHERE doc_id = ?", (doc_id,))}
    if set(b.grants) != allowed:
        raise HTTPException(422, "The new keys must cover exactly the people who have access")
    have = {r["id"] for r in db.execute("SELECT id FROM comments WHERE doc_id = ?", (doc_id,))}
    if set(b.comments) != have:
        raise HTTPException(409, {"code": "changed", "message": "A comment was added while the key was changing. Try again."})
    now = time.time()
    db.execute("UPDATE documents SET zk_title = ?, updated_at = ? WHERE id = ?", (b.title_enc, now, doc_id))
    for cid, c in b.comments.items():
        db.execute("UPDATE comments SET body = ?, quote = ? WHERE id = ? AND doc_id = ?", (str(c.get("body", ""))[:12000], str(c.get("quote", ""))[:1600], cid, doc_id))
    db.execute("DELETE FROM zk_updates WHERE doc_id = ?", (doc_id,))
    db.execute("INSERT OR REPLACE INTO zk_checkpoints (doc_id, upto, blob, created_at) VALUES (?,?,?,?)", (doc_id, newest, unb64(b.checkpoint), now))
    for e, sealed in b.grants.items():
        db.execute("UPDATE zk_grants SET sealed = ?, by_email = ?, created_at = ? WHERE doc_id = ? AND email = ?", (sealed, acc.user["email"], now, doc_id, e))
    drop_zk_images(db, doc_id, {f"{n}.zkimg" for n in b.images if ZK_IMG.match(n)})
    db.commit()
    await evict_room(doc_id)
    return {"ok": True}


# ───────────────────────── pictures ─────────────────────────
# A picture in an encrypted document is encrypted in the browser, so what is stored here is ciphertext under a random name.
# The name is in the document (as /api/zk/img/<name>); the browser downloads the bytes, opens them with the document's key and shows the result.
MAX_ZK_IMAGE = 12 * 1024 * 1024 + 4096    # the picture limit, plus the few bytes encryption adds
ZK_IMG = re.compile(r"^[0-9a-f]{32}$")


def shred(name: str) -> None:
    """Remove a stored picture: overwritten first, so its bytes don't linger on the disk."""
    path = UPLOAD_DIR / name
    try:
        if path.is_file():
            n = path.stat().st_size
            with open(path, "r+b") as f:
                f.write(b"\0" * n)
                f.flush()
        path.unlink(missing_ok=True)
    except OSError:
        pass


def drop_plain_images(db, doc_id: str) -> None:
    """After a document is encrypted (its pictures were re-stored encrypted): the unencrypted copies go, unless another file still uses one."""
    names = [r["name"] for r in db.execute("SELECT name FROM upload_refs WHERE doc_id = ?", (doc_id,)) if not r["name"].endswith(".zkimg")]
    for n in names:
        db.execute("DELETE FROM upload_refs WHERE name = ? AND doc_id = ?", (n, doc_id))
        if db.execute("SELECT 1 FROM upload_refs WHERE name = ?", (n,)).fetchone():
            db.execute("UPDATE uploads SET doc_id = (SELECT doc_id FROM upload_refs WHERE name = ? LIMIT 1) WHERE name = ?", (n, n))
            continue
        shred(n)
        db.execute("DELETE FROM uploads WHERE name = ?", (n,))
        for a in db.execute("SELECT name FROM image_aliases WHERE target = ?", (n,)).fetchall():
            db.execute("DELETE FROM image_aliases WHERE name = ?", (a["name"],))


def drop_zk_images(db, doc_id: str, keep: set[str]) -> None:
    for r in db.execute("SELECT name FROM uploads WHERE doc_id = ? AND name LIKE '%.zkimg'", (doc_id,)).fetchall():
        if r["name"] not in keep:
            shred(r["name"])
            db.execute("DELETE FROM uploads WHERE name = ?", (r["name"],))
            db.execute("DELETE FROM upload_refs WHERE name = ?", (r["name"],))


@router.post("/zk/docs/{doc_id}/images")
async def upload_image(doc_id: str, file: UploadFile = File(...), c=Depends(ctx), db=Depends(get_db)):
    """Store an already-encrypted picture. Allowed while a document is being converted too, hence no check that it is encrypted yet."""
    from . import quota
    doc, acc = access.require(db, doc_id, *c, minimum="editor")
    data = await file.read(MAX_ZK_IMAGE + 1)
    if len(data) > MAX_ZK_IMAGE:
        raise HTTPException(413, "Image is larger than 12 MB")
    if len(data) < 60:
        raise HTTPException(422, "That isn't an encrypted picture")
    quota.check(db, doc["owner_id"], len(data), "The document's owner" if acc.role != "owner" else "Your account")
    name = uuid.uuid4().hex
    (UPLOAD_DIR / f"{name}.zkimg").write_bytes(data)
    db.execute("INSERT INTO uploads (name, doc_id, owner_id, size, created_at, hash) VALUES (?,?,?,?,?,?)", (f"{name}.zkimg", doc_id, doc["owner_id"], len(data), time.time(), hashlib.sha256(data).hexdigest()))
    db.execute("INSERT OR IGNORE INTO upload_refs (name, doc_id) VALUES (?,?)", (f"{name}.zkimg", doc_id))
    db.commit()
    return {"url": f"/api/zk/img/{name}"}


@router.get("/zk/img/{name}")
def get_image(name: str):
    """The encrypted bytes. Random name, useless without the document's key."""
    path = UPLOAD_DIR / f"{name}.zkimg"
    if not ZK_IMG.match(name) or not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, media_type="application/octet-stream", headers={"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"})


class FetchImage(BaseModel):
    url: str = Field(max_length=2000)


@router.post("/zk/docs/{doc_id}/images/fetch")
async def fetch_image(doc_id: str, b: FetchImage, request: Request, c=Depends(ctx), db=Depends(get_db)):
    """A picture pasted from the web: the server fetches it (a public picture, so nothing private is involved) and hands the bytes back,
    for the browser to encrypt and store. Nothing is kept here."""
    _, acc = access.require(db, doc_id, *c, minimum="editor")
    who = acc.user["id"] if acc.user else (request.client.host if request.client else "?")
    if not import_limiter.allow(f"imgimport:{who}"):
        raise HTTPException(429, "Too many pictures at once. Try again in a minute.")
    data = await fetch_public_image(b.url)
    if not sniff(data):
        raise HTTPException(415, "That link isn't a PNG, JPEG, GIF or WebP picture")
    return Response(data, media_type="application/octet-stream")
