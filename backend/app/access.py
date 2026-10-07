"""Who can do what on a document. Single source of truth for REST and WebSocket."""
import sqlite3
from dataclasses import dataclass

from fastapi import HTTPException

from .security import doc_token_valid, read_token

RANK = {"viewer": 1, "editor": 2, "manager": 3, "owner": 4}   # a manager can edit and manage who has access; only the owner can delete


@dataclass
class Access:
    role: str | None
    reason: str | None = None  # login_required | password_required | forbidden
    user: sqlite3.Row | None = None


def get_user(db: sqlite3.Connection, token: str | None):
    uid = read_token(token)
    if not uid:
        return None
    u = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    return None if u is not None and u["disabled"] else u


def admin_emails() -> set[str]:
    """Accounts with these emails are always admins (comma-separated KOKO_ADMIN_EMAILS, default koko@kokodev.cc)."""
    import os
    return {e.strip().lower() for e in os.environ.get("KOKO_ADMIN_EMAILS", "koko@kokodev.cc").split(",") if e.strip()}


def is_admin(u) -> bool:
    return bool(u) and (u["email"].lower() in admin_emails() or bool(u["is_admin"]))


def folder_grant(db: sqlite3.Connection, user, fid: str, links: bool = True) -> str | None:
    """Role granted by this one folder (a share for the user, or an 'anyone with the link' setting)."""
    best = None
    if user:
        row = db.execute("SELECT role FROM folder_shares WHERE folder_id = ? AND email = ?", (fid, user["email"])).fetchone()
        if row:
            best = row["role"]
    if links:
        f = db.execute("SELECT link_access, link_role FROM folders WHERE id = ?", (fid,)).fetchone()
        if f and f["link_access"] == "anyone" and (best is None or RANK[f["link_role"]] > RANK[best]):
            best = f["link_role"]
    return best


def folder_role(db: sqlite3.Connection, user, folder_id: str | None, links: bool = True) -> str | None:
    """Best role on a folder via a share or link on it or any ancestor. `user` may be None (signed out)."""
    best, fid, hops = None, folder_id, 0
    while fid and hops < 50:
        g = folder_grant(db, user, fid, links)
        if g and (best is None or RANK[g] > RANK[best]):
            best = g
        parent = db.execute("SELECT parent_id FROM folders WHERE id = ?", (fid,)).fetchone()
        fid = parent["parent_id"] if parent else None
        hops += 1
    return best


def resolve(db: sqlite3.Connection, doc: sqlite3.Row, user, doc_token: str | None) -> Access:
    if doc["deleted_at"]:
        return Access(None, "not_found", user)

    best: str | None = None

    def bump(role: str):
        nonlocal best
        if best is None or RANK[role] > RANK[best]:
            best = role

    if user:
        if user["id"] == doc["owner_id"]:
            return Access("owner", user=user)
        row = db.execute(
            "SELECT role FROM shares WHERE doc_id = ? AND email = ?", (doc["id"], user["email"])
        ).fetchone()
        if row:
            bump(row["role"])
        if is_admin(user):
            bump("viewer")  # admins can open anything read-only, for moderation

    is_form = doc["kind"] == "form"
    # On a form, "anyone with the link" can only ever fill it out (viewer), never edit it.
    inherited = folder_role(db, user, doc["folder_id"], links=not is_form) if doc["folder_id"] else None
    if inherited:
        bump(inherited)
    if is_form and doc["folder_id"] and folder_role(db, user, doc["folder_id"]):
        bump("viewer")
    link_role = "viewer" if is_form else doc["link_role"]

    mode = doc["link_access"]
    if mode == "anyone":
        bump(link_role)
    elif mode == "password" and doc_token_valid(doc_token, doc["id"]):
        bump(link_role)

    if best:
        return Access(best, user=user)
    if mode == "password":
        return Access(None, "password_required", user)
    if not user:
        return Access(None, "login_required")
    return Access(None, "forbidden", user)


def require(db, doc_id: str, token: str | None, doc_token: str | None, minimum: str = "viewer"):
    doc = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if not doc:
        raise HTTPException(404, {"code": "not_found", "message": "Document not found"})
    user = get_user(db, token)
    if doc["deleted_at"]:
        is_owner = bool(user and user["id"] == doc["owner_id"])
        raise HTTPException(404, {"code": "trashed" if is_owner else "not_found", "message": "This document is in the recycle bin" if is_owner else "Document not found"})
    acc = resolve(db, doc, user, doc_token)
    if not acc.role:
        status = 401 if acc.reason == "login_required" else 403
        raise HTTPException(status, {"code": acc.reason, "message": "You don't have access to this document"})
    if RANK[acc.role] < RANK[minimum]:
        raise HTTPException(403, {"code": "forbidden", "message": f"{minimum} access required"})
    return doc, acc
