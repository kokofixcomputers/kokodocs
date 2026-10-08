"""Optional email: 6-digit codes to confirm new accounts and to reset forgotten passwords. Off until an admin has
configured SMTP and a test email has been delivered, so a broken mail setup can never lock people out of signing up."""
import asyncio
import hashlib
import hmac
import json
import secrets
import smtplib
import ssl
import time
import uuid
from email.message import EmailMessage

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .db import get_db, settings_get
from .routes import COLORS, EMAIL_RE, SignupIn, public_user
from .security import SECRET, RateLimiter, decrypt_secret, hash_password, make_token

router = APIRouter(prefix="/api")
CODE_TTL = 10 * 60
COOLDOWN = 30
MAX_ATTEMPTS = 5
ip_limiter = RateLimiter(120, 3600)
mail_limiter = RateLimiter(6, 3600)


# ───────────── configuration and sending ─────────────
def smtp_config(db) -> dict:
    return {"host": settings_get(db, "smtp_host"), "port": int(settings_get(db, "smtp_port", "587") or 587), "security": settings_get(db, "smtp_security", "starttls"),
            "user": settings_get(db, "smtp_user"), "password": decrypt_secret(settings_get(db, "smtp_password")) or "", "from": settings_get(db, "smtp_from")}


def email_configured(db) -> bool:
    """Mail can be attempted (host and From address are set). Notifications use this; sign-up codes need the stricter email_enabled."""
    c = smtp_config(db)
    return bool(c["host"] and c["from"])


def email_enabled(db) -> bool:
    c = smtp_config(db)
    return bool(c["host"] and c["from"] and settings_get(db, "smtp_ok") == "1")


def send_email_sync(cfg: dict, to: str, subject: str, text: str, html: str | None = None) -> None:
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = cfg["from"], to, subject
    msg["Message-ID"] = f"<{uuid.uuid4().hex}@kokodocs>"
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    ctx = ssl.create_default_context()
    if cfg["security"] == "ssl":
        smtp = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=15, context=ctx)
    else:
        smtp = smtplib.SMTP(cfg["host"], cfg["port"], timeout=15)
    with smtp:
        smtp.ehlo()
        if cfg["security"] == "starttls":
            smtp.starttls(context=ctx)
            smtp.ehlo()
        if cfg["user"]:
            smtp.login(cfg["user"], cfg["password"])
        smtp.send_message(msg)


async def send_email(db, to: str, subject: str, text: str, html: str | None = None) -> None:
    cfg = smtp_config(db)
    await asyncio.to_thread(send_email_sync, cfg, to, subject, text, html)


def code_mail(code: str, purpose: str) -> tuple[str, str, str]:
    subject = f"{code} is your KokoDocs code"
    text = f"Your KokoDocs code to {purpose} is {code}.\n\nIt expires in 10 minutes. If you didn't ask for this, you can ignore this email."
    html = (f'<div style="font-family:Inter,Arial,sans-serif;max-width:420px;margin:auto;padding:24px"><h2 style="margin:0 0 8px">KokoDocs</h2>'
            f'<p style="color:#555">Your code to {purpose}:</p><p style="font-size:34px;letter-spacing:8px;font-weight:700;margin:12px 0">{code}</p>'
            f'<p style="color:#888;font-size:13px">It expires in 10 minutes. If you didn\'t ask for this, you can ignore this email.</p></div>')
    return subject, text, html


# ───────────── code storage ─────────────
def hash_code(key: str, code: str) -> str:
    return hmac.new(SECRET.encode(), f"{key}|{code}".encode(), hashlib.sha256).hexdigest()


async def issue_code(db, kind: str, email: str, purpose: str, payload: dict | None = None) -> None:
    key = f"{kind}:{email}"
    row = db.execute("SELECT sent_at FROM email_codes WHERE key = ?", (key,)).fetchone()
    now = time.time()
    if row and now - row["sent_at"] < COOLDOWN:
        raise HTTPException(429, f"Wait {int(COOLDOWN - (now - row['sent_at'])) + 1} seconds before asking for another code")
    if not mail_limiter.allow(key):
        raise HTTPException(429, "Too many emails requested. Try again later.")
    code = f"{secrets.randbelow(1_000_000):06d}"
    db.execute("INSERT INTO email_codes (key, code_hash, payload, expires_at, attempts, sent_at) VALUES (?,?,?,?,0,?) "
               "ON CONFLICT(key) DO UPDATE SET code_hash = excluded.code_hash, payload = excluded.payload, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at",
               (key, hash_code(key, code), json.dumps(payload or {}), now + CODE_TTL, now))
    db.commit()
    try:
        await send_email(db, email, *code_mail(code, purpose))
    except Exception:
        db.execute("DELETE FROM email_codes WHERE key = ?", (key,)); db.commit()
        raise HTTPException(502, "We couldn't send the email. Please try again later or contact the administrator.")


def check_code(db, kind: str, email: str, code: str) -> dict:
    key = f"{kind}:{email}"
    row = db.execute("SELECT * FROM email_codes WHERE key = ?", (key,)).fetchone()
    code = "".join(ch for ch in code if ch.isdigit())
    if not row or row["expires_at"] < time.time():
        raise HTTPException(400, "That code has expired. Request a new one.")
    if row["attempts"] >= MAX_ATTEMPTS:
        db.execute("DELETE FROM email_codes WHERE key = ?", (key,)); db.commit()
        raise HTTPException(400, "Too many wrong codes. Request a new one.")
    if not hmac.compare_digest(row["code_hash"], hash_code(key, code)):
        db.execute("UPDATE email_codes SET attempts = attempts + 1 WHERE key = ?", (key,)); db.commit()
        raise HTTPException(400, "That code isn't right")
    db.execute("DELETE FROM email_codes WHERE key = ?", (key,)); db.commit()
    return json.loads(row["payload"])


def guard(request: Request) -> None:
    if not ip_limiter.allow(request.client.host if request.client else "?"):
        raise HTTPException(429, "Too many requests. Try again later.")


def need_email(db) -> None:
    if not email_enabled(db):
        raise HTTPException(404, "Email isn't set up on this server")


# ───────────── sign up with a confirmed email ─────────────
@router.post("/auth/signup/start")
async def signup_start(b: SignupIn, request: Request, db=Depends(get_db)):
    guard(request); need_email(db)
    if settings_get(db, "signup_enabled", "1") != "1":
        raise HTTPException(403, "Sign-ups are currently closed")
    email = b.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "Enter a valid email address")
    if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        raise HTTPException(409, "An account with this email already exists")
    await issue_code(db, "signup", email, "confirm your email", {"name": b.name.strip(), "pw": hash_password(b.password)})
    return {"sent": True, "cooldown": COOLDOWN}


class Resend(BaseModel):
    email: str


@router.post("/auth/signup/resend")
async def signup_resend(b: Resend, request: Request, db=Depends(get_db)):
    guard(request); need_email(db)
    email = b.email.strip().lower()
    row = db.execute("SELECT payload FROM email_codes WHERE key = ?", (f"signup:{email}",)).fetchone()
    if not row:
        raise HTTPException(400, "Start again from the sign-up form")
    await issue_code(db, "signup", email, "confirm your email", json.loads(row["payload"]))
    return {"sent": True, "cooldown": COOLDOWN}


class Verify(BaseModel):
    email: str
    code: str = Field(max_length=20)


@router.post("/auth/signup/verify")
def signup_verify(b: Verify, request: Request, db=Depends(get_db)):
    guard(request); need_email(db)
    email = b.email.strip().lower()
    p = check_code(db, "signup", email, b.code)
    if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        raise HTTPException(409, "An account with this email already exists")
    uid = uuid.uuid4().hex
    db.execute("INSERT INTO users (id, email, name, password_hash, color, created_at, email_verified) VALUES (?,?,?,?,?,?,1)",
               (uid, email, p["name"], p["pw"], COLORS[secrets.randbelow(len(COLORS))], time.time()))
    db.commit()
    user = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    return {"token": make_token(uid), "user": public_user(user)}


# ───────────── forgotten password ─────────────
@router.post("/auth/password/forgot")
async def password_forgot(b: Resend, request: Request, db=Depends(get_db)):
    guard(request); need_email(db)
    email = b.email.strip().lower()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if user and not user["disabled"]:
        try:
            await issue_code(db, "reset", email, "reset your password")
        except HTTPException as e:
            if e.status_code == 429:
                raise
            # sending problems are logged server-side only; the response never reveals whether the account exists
    return {"sent": True, "cooldown": COOLDOWN}


class Reset(BaseModel):
    email: str
    code: str = Field(max_length=20)
    password: str = Field("", max_length=200)   # not sent for accounts that use encryption: the browser handles their new password itself


@router.post("/auth/password/reset")
def password_reset(b: Reset, request: Request, db=Depends(get_db)):
    guard(request); need_email(db)
    email = b.email.strip().lower()
    check_code(db, "reset", email, b.code)
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or user["disabled"]:
        raise HTTPException(400, "That code isn't right")
    if user["zk_enabled"]:   # the code proved the email; a new password can only come with the recovery key (or by giving up the encrypted data)
        from .zk import keys_view, make_reset_token
        return {"ok": True, "zk": True, "token": make_reset_token(user["id"]), "keys": keys_view(user)}
    if len(b.password) < 8:
        raise HTTPException(422, "Use at least 8 characters")
    db.execute("UPDATE users SET password_hash = ?, pw_set = 1 WHERE id = ?", (hash_password(b.password), user["id"]))
    db.commit()
    return {"ok": True}
