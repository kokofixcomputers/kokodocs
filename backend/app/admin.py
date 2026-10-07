"""Admin panel API: see everyone on the instance, promote/demote, suspend, reset passwords, delete accounts."""
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import access
from . import quota
from .db import UPLOAD_DIR, get_db, settings_get, settings_set
from .authx import redirect_uri
from .emailauth import email_enabled, send_email, smtp_config
from .security import decrypt_secret, encrypt_secret
from fastapi import Request
from .routes import must_admin
from .security import hash_password

router = APIRouter(prefix="/api/admin")


def row(u, docs, sheets, used=0, default=500):
    mb = u["quota_mb"] if u["quota_mb"] is not None else default
    return {"used": used, "quota_mb": u["quota_mb"], "limit_mb": mb, "id": u["id"], "email": u["email"], "name": u["name"], "color": u["color"], "created_at": u["created_at"],
            "is_admin": access.is_admin(u), "builtin_admin": u["email"].lower() in access.admin_emails(), "disabled": bool(u["disabled"]), "totp": bool(u["totp_enabled"]),
            "docs": docs, "sheets": sheets}


@router.get("/users")
def users(admin=Depends(must_admin), db=Depends(get_db)):
    counts = {}
    for r in db.execute("SELECT owner_id, kind, COUNT(*) AS n FROM documents WHERE deleted_at IS NULL GROUP BY owner_id, kind"):
        counts.setdefault(r["owner_id"], {})[r["kind"]] = r["n"]
    used, dflt = quota.usage_all(db), quota.default_mb(db)
    return [row(u, counts.get(u["id"], {}).get("doc", 0), counts.get(u["id"], {}).get("sheet", 0), used.get(u["id"], 0), dflt) for u in db.execute("SELECT * FROM users ORDER BY created_at DESC")]


@router.get("/stats")
def stats(admin=Depends(must_admin), db=Depends(get_db)):
    one = lambda q: db.execute(q).fetchone()[0]
    size = sum(os.path.getsize(os.path.join(UPLOAD_DIR, f)) for f in os.listdir(UPLOAD_DIR)) if os.path.isdir(UPLOAD_DIR) else 0
    return {"users": one("SELECT COUNT(*) FROM users"), "documents": one("SELECT COUNT(*) FROM documents WHERE kind = 'doc' AND deleted_at IS NULL"),
            "spreadsheets": one("SELECT COUNT(*) FROM documents WHERE kind = 'sheet' AND deleted_at IS NULL"), "presentations": one("SELECT COUNT(*) FROM documents WHERE kind = 'slides' AND deleted_at IS NULL"), "forms": one("SELECT COUNT(*) FROM documents WHERE kind = 'form' AND deleted_at IS NULL"), "trashed": one("SELECT COUNT(*) FROM documents WHERE deleted_at IS NOT NULL"),
            "comments": one("SELECT COUNT(*) FROM comments"), "versions": one("SELECT COUNT(*) FROM versions"), "upload_bytes": size + one("SELECT COALESCE(SUM(size), 0) FROM form_files")}


class Patch(BaseModel):
    is_admin: bool | None = None
    disabled: bool | None = None
    name: str | None = Field(None, min_length=1, max_length=80)
    password: str | None = Field(None, min_length=8, max_length=200)
    reset_2fa: bool | None = None
    quota_mb: int | None = Field(None, ge=0, le=1_000_000)
    clear_quota: bool | None = None  # back to the server default


def target(db, uid):
    u = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if not u:
        raise HTTPException(404, "User not found")
    return u


@router.patch("/users/{uid}")
def patch_user(uid: str, b: Patch, admin=Depends(must_admin), db=Depends(get_db)):
    u = target(db, uid)
    builtin = u["email"].lower() in access.admin_emails()
    if uid == admin["id"] and (b.disabled or b.is_admin is False):
        raise HTTPException(400, "You can't remove your own admin access or suspend yourself")
    if builtin and (b.disabled or b.is_admin is False):
        raise HTTPException(400, "This account is a built-in admin")
    if b.is_admin is not None:
        db.execute("UPDATE users SET is_admin = ? WHERE id = ?", (int(b.is_admin), uid))
    if b.disabled is not None:
        db.execute("UPDATE users SET disabled = ? WHERE id = ?", (int(b.disabled), uid))
    if b.name:
        db.execute("UPDATE users SET name = ? WHERE id = ?", (b.name.strip(), uid))
    if b.quota_mb is not None:
        db.execute("UPDATE users SET quota_mb = ? WHERE id = ?", (b.quota_mb, uid))
    if b.clear_quota:
        db.execute("UPDATE users SET quota_mb = NULL WHERE id = ?", (uid,))
    if b.reset_2fa:
        db.execute("UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_recovery = '[]' WHERE id = ?", (uid,))
    if b.password:
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(b.password), uid))
    db.commit()
    n = db.execute("SELECT kind, COUNT(*) AS n FROM documents WHERE owner_id = ? AND deleted_at IS NULL GROUP BY kind", (uid,)).fetchall()
    c = {r["kind"]: r["n"] for r in n}
    return row(target(db, uid), c.get("doc", 0), c.get("sheet", 0), quota.breakdown(db, uid)["total"], quota.default_mb(db))


@router.delete("/users/{uid}")
def delete_user(uid: str, admin=Depends(must_admin), db=Depends(get_db)):
    u = target(db, uid)
    if uid == admin["id"]:
        raise HTTPException(400, "You can't delete your own account here")
    if u["email"].lower() in access.admin_emails():
        raise HTTPException(400, "This account is a built-in admin")
    quota.drop_uploads(db, "owner_id = ?", (uid,))
    db.execute("DELETE FROM users WHERE id = ?", (uid,))   # their documents, folders, comments and settings cascade
    db.commit()
    return {"ok": True}


# ───────────── instance settings ─────────────
def settings_view(db, request: Request):
    return {"signup_enabled": settings_get(db, "signup_enabled", "1") == "1", "google_client_id": settings_get(db, "google_client_id"),
            "google_secret_set": bool(settings_get(db, "google_client_secret")), "public_url": settings_get(db, "public_url"), "default_quota_mb": quota.default_mb(db),
            "smtp_host": settings_get(db, "smtp_host"), "smtp_port": int(settings_get(db, "smtp_port", "587") or 587), "smtp_security": settings_get(db, "smtp_security", "starttls"),
            "smtp_user": settings_get(db, "smtp_user"), "smtp_password_set": bool(settings_get(db, "smtp_password")), "smtp_from": settings_get(db, "smtp_from"),
            "email_active": email_enabled(db), "redirect_uri": redirect_uri(request, db)}


class SettingsIn(BaseModel):
    signup_enabled: bool | None = None
    google_client_id: str | None = Field(None, max_length=300)
    google_client_secret: str | None = Field(None, max_length=300)
    public_url: str | None = Field(None, max_length=300)
    default_quota_mb: int | None = Field(None, ge=0, le=1_000_000)
    smtp_host: str | None = Field(None, max_length=200)
    smtp_port: int | None = Field(None, ge=1, le=65535)
    smtp_security: str | None = Field(None, pattern="^(starttls|ssl|none)$")
    smtp_user: str | None = Field(None, max_length=200)
    smtp_password: str | None = Field(None, max_length=500)
    smtp_from: str | None = Field(None, max_length=200)


@router.get("/settings")
def get_settings(request: Request, admin=Depends(must_admin), db=Depends(get_db)):
    return settings_view(db, request)


@router.put("/settings")
def put_settings(b: SettingsIn, request: Request, admin=Depends(must_admin), db=Depends(get_db)):
    if b.signup_enabled is not None:
        settings_set(db, "signup_enabled", "1" if b.signup_enabled else "0")
    if b.google_client_id is not None:
        settings_set(db, "google_client_id", b.google_client_id.strip())
    if b.google_client_secret:
        settings_set(db, "google_client_secret", encrypt_secret(b.google_client_secret.strip()))
    if b.google_client_secret == "" and b.google_client_id == "":
        settings_set(db, "google_client_secret", "")
    smtp_changed = False
    for key in ("smtp_host", "smtp_user", "smtp_from"):
        v = getattr(b, key)
        if v is not None and v.strip() != settings_get(db, key):
            settings_set(db, key, v.strip()); smtp_changed = True
    for key in ("smtp_port", "smtp_security"):
        v = getattr(b, key)
        if v is not None and str(v) != settings_get(db, key):
            settings_set(db, key, str(v)); smtp_changed = True
    if b.smtp_password:
        settings_set(db, "smtp_password", encrypt_secret(b.smtp_password)); smtp_changed = True
    if smtp_changed:
        settings_set(db, "smtp_ok", "0")   # must pass a test email again before accounts depend on it
    if b.default_quota_mb is not None:
        settings_set(db, "default_quota_mb", str(b.default_quota_mb))
    if b.public_url is not None:
        settings_set(db, "public_url", b.public_url.strip().rstrip("/"))
    db.commit()
    return settings_view(db, request)


# ───────────── moderation: browse and remove anyone's files ─────────────
@router.get("/files")
def files(owner: str | None = None, q: str = "", limit: int = 200, admin=Depends(must_admin), db=Depends(get_db)):
    sql = "SELECT d.id, d.title, d.kind, d.created_at, d.updated_at, d.deleted_at, d.link_access, d.link_role, u.id AS owner_id, u.name AS owner_name, u.email AS owner_email FROM documents d JOIN users u ON u.id = d.owner_id WHERE 1=1"
    args: list = []
    if owner:
        sql += " AND d.owner_id = ?"; args.append(owner)
    if q:
        sql += " AND (d.title LIKE ? OR u.email LIKE ? OR u.name LIKE ?)"; args += [f"%{q}%"] * 3
    sql += " ORDER BY d.updated_at DESC LIMIT ?"; args.append(min(max(limit, 1), 500))
    return [dict(r) for r in db.execute(sql, args)]


@router.delete("/files/{doc_id}")
def delete_file(doc_id: str, admin=Depends(must_admin), db=Depends(get_db)):
    if not db.execute("SELECT 1 FROM documents WHERE id = ?", (doc_id,)).fetchone():
        raise HTTPException(404, "Not found")
    quota.drop_uploads(db, "id = ?", (doc_id,))
    db.execute("DELETE FROM documents WHERE id = ?", (doc_id,))   # versions, shares, comments cascade
    db.commit()
    return {"ok": True}


@router.post("/email/test")
async def email_test(admin=Depends(must_admin), db=Depends(get_db)):
    """Sends a real message to the admin's own address. Email-based sign-up and password reset switch on once this succeeds."""
    c = smtp_config(db)
    if not (c["host"] and c["from"]):
        raise HTTPException(400, "Enter an SMTP host and a From address first")
    try:
        await send_email(db, admin["email"], "KokoDocs test email", "Email is working. People can now confirm their address with a code and reset forgotten passwords.")
    except Exception as e:
        settings_set(db, "smtp_ok", "0"); db.commit()
        raise HTTPException(502, f"Couldn't send: {type(e).__name__}: {str(e)[:200]}")
    settings_set(db, "smtp_ok", "1"); db.commit()
    return {"ok": True, "sent_to": admin["email"]}


@router.delete("/email")
def email_remove(admin=Depends(must_admin), db=Depends(get_db)):
    for k in ("smtp_host", "smtp_user", "smtp_password", "smtp_from", "smtp_ok"):
        settings_set(db, k, "")
    db.commit()
    return {"ok": True}
