"""In-app notifications (the bell on the documents screen) and mention emails."""
import asyncio
import logging
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import access
from .db import connect, get_db
from .routes import must_user

router = APIRouter(prefix="/api")
log = logging.getLogger("uvicorn.error")


def can_open(db, user, doc) -> bool:
    """Owner, directly shared, or via a shared folder. (Public links don't count: nobody is notified into a file by a link.)"""
    if user["id"] == doc["owner_id"]:
        return True
    if db.execute("SELECT 1 FROM shares WHERE doc_id = ? AND email = ?", (doc["id"], user["email"])).fetchone():
        return True
    return bool(doc["folder_id"] and access.folder_role(db, user, doc["folder_id"], links=False))


def add(db, user_id: str, kind: str, doc, actor_name: str, text: str = "", link: str | None = None) -> None:
    db.execute("INSERT INTO notifications (id, user_id, kind, doc_id, doc_title, actor_name, text, link, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
               (uuid.uuid4().hex[:16], user_id, kind, doc["id"], doc["title"], actor_name, text[:300], link or f"/d/{doc['id']}", time.time()))


def mention_mail(actor: str, title: str, text: str, url: str) -> tuple[str, str, str]:
    subject = f"{actor} mentioned you in “{title}”"
    plain = f"{actor} mentioned you in “{title}”:\n\n  {text}\n\nOpen it: {url}\n\nYou can turn these emails off in Account security."
    safe = text.replace("&", "&amp;").replace("<", "&lt;")
    html = (f'<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto;padding:24px"><h2 style="margin:0 0 6px">KokoDocs</h2>'
            f'<p style="color:#555;margin:0 0 14px"><b>{actor}</b> mentioned you in <b>{title.replace("<", "&lt;")}</b></p>'
            f'<blockquote style="margin:0 0 18px;padding:10px 14px;border-left:3px solid #111;background:#f4f4f4;border-radius:6px">{safe}</blockquote>'
            f'<a href="{url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600">Open the comment</a>'
            f'<p style="color:#999;font-size:12px;margin-top:22px">You can turn these emails off in Account security.</p></div>')
    return subject, plain, html


async def send_mail_background(to: str, subject: str, plain: str, html: str) -> None:
    from .emailauth import email_configured, send_email
    # Unlike sign-up codes, this doesn't wait for a passed test email: if SMTP is filled in, try it.
    def cfg():
        with connect() as db:
            return email_configured(db)
    if not await asyncio.to_thread(cfg):
        log.warning("Mention email to %s not sent: email (SMTP) is not set up in the admin panel", to)
        return
    try:
        with connect() as db:
            await send_email(db, to, subject, plain, html)
    except Exception as e:   # a failed mention email must never break commenting, but say why in the server log
        log.warning("Mention email to %s failed: %s: %s", to, type(e).__name__, str(e)[:200])


def shared_with(db, doc, email: str) -> bool:
    """Is this address on the file's (or its folder's) share list? Used for people who haven't made an account yet."""
    if db.execute("SELECT 1 FROM shares WHERE doc_id = ? AND email = ?", (doc["id"], email)).fetchone():
        return True
    fid, hops = doc["folder_id"], 0
    while fid and hops < 50:
        if db.execute("SELECT 1 FROM folder_shares WHERE folder_id = ? AND email = ?", (fid, email)).fetchone():
            return True
        p = db.execute("SELECT parent_id FROM folders WHERE id = ?", (fid,)).fetchone()
        fid, hops = (p["parent_id"] if p else None), hops + 1
    return False


def on_comment(db, doc, author, body: str, mentions: list[str], cid: str, parent) -> tuple[list[tuple[str, str, str, str]], list[dict]]:
    """Creates the in-app notifications for a new comment. Returns (emails to send as (to, actor, text, link), people who could not be notified)."""
    emails: list[tuple[str, str, str, str]] = []
    skipped: list[dict] = []
    link = f"/d/{doc['id']}?comment={cid}"
    notified: set[str] = set()   # who has already been told about this comment (an explicit @mention of yourself counts: handy as a test)
    for e in mentions:
        u = db.execute("SELECT * FROM users WHERE email = ? AND disabled = 0", (e,)).fetchone()
        if not u:
            # shared with this address but no account yet: still email them, so they know to sign up with it
            if shared_with(db, doc, e):
                emails.append((e, author["name"], body, link))
            else:
                log.info("Mention of %s skipped: no account, and the file isn't shared with that address", e)
                skipped.append({"email": e, "reason": "not_shared"})
            continue
        if u["id"] in notified:
            continue
        if not can_open(db, u, doc):
            log.info("Mention of %s skipped: that account can't open this file (only link access, or not shared)", e)
            skipped.append({"email": e, "reason": "not_shared"})
            continue
        notified.add(u["id"])
        add(db, u["id"], "mention", doc, author["name"], body, link)
        if u["notify_email"]:
            emails.append((u["email"], author["name"], body, link))
        else:
            log.info("Mention email to %s skipped: they turned email notifications off", e)
    # the owner and the person who started the thread hear about new comments (in the app only)
    notified.add(author["id"])   # never tell people about their own comment, apart from an explicit @mention above
    for uid in {doc["owner_id"], parent["user_id"] if parent else None} - {None}:
        if uid not in notified:
            notified.add(uid)
            add(db, uid, "comment", doc, author["name"], body, link)
    return emails, skipped


@router.get("/notifications")
def list_notifications(user=Depends(must_user), db=Depends(get_db)):
    rows = db.execute("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", (user["id"],)).fetchall()
    unread = db.execute("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL", (user["id"],)).fetchone()[0]
    return {"unread": unread, "items": [{"id": r["id"], "kind": r["kind"], "doc_id": r["doc_id"], "doc_title": r["doc_title"], "actor": r["actor_name"], "text": r["text"], "link": r["link"], "created_at": r["created_at"], "read": r["read_at"] is not None} for r in rows]}


@router.get("/notifications/count")
def count(user=Depends(must_user), db=Depends(get_db)):
    return {"unread": db.execute("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL", (user["id"],)).fetchone()[0]}


class ReadIn(BaseModel):
    ids: list[str] | None = None
    all: bool = False


@router.post("/notifications/read")
def mark_read(b: ReadIn, user=Depends(must_user), db=Depends(get_db)):
    now = time.time()
    if b.all:
        db.execute("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", (now, user["id"]))
    elif b.ids:
        db.executemany("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL", [(now, i, user["id"]) for i in b.ids[:200]])
    db.commit()
    return {"ok": True}


class Prefs(BaseModel):
    notify_email: bool


@router.put("/me/prefs")
def put_prefs(b: Prefs, user=Depends(must_user), db=Depends(get_db)):
    db.execute("UPDATE users SET notify_email = ? WHERE id = ?", (int(b.notify_email), user["id"]))
    db.commit()
    return {"notify_email": b.notify_email}


class Profile(BaseModel):
    name: str


@router.put("/me/profile")
def put_profile(b: Profile, user=Depends(must_user), db=Depends(get_db)):
    name = " ".join(b.name.split())[:60]
    if not name:
        raise HTTPException(400, "Enter a name")
    db.execute("UPDATE users SET name = ? WHERE id = ?", (name, user["id"]))
    db.commit()
    return {"name": name}
