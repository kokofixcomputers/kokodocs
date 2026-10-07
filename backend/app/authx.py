"""Extra sign-in options: TOTP two-factor (authenticator apps), Google sign-in, and the public auth config."""
import base64
import hashlib
import hmac
import json
import secrets
import struct
import time
import urllib.parse
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from . import access
from .db import get_db, settings_get
from .routes import COLORS, EMAIL_RE, must_user, public_user
from .emailauth import email_enabled
from .security import RateLimiter, check_password, decrypt_secret, encrypt_secret, hash_password, make_mfa_token, make_state, make_token, read_mfa_token, read_state

router = APIRouter(prefix="/api")
mfa_limiter = RateLimiter(8, 60)
ISSUER = "KokoDocs"


# ───────────── TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ─────────────
def totp_at(secret_b32: str, step: int) -> str:
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))
    h = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    o = h[-1] & 15
    return f"{(struct.unpack('>I', h[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


def totp_check(secret_b32: str, code: str, last_used: int = 0) -> int | None:
    """Returns the matched time step (so a code can't be replayed), or None."""
    code = "".join(ch for ch in code if ch.isdigit())
    if len(code) != 6:
        return None
    now = int(time.time() // 30)
    for step in (now, now - 1, now + 1):
        if step > last_used and hmac.compare_digest(totp_at(secret_b32, step), code):
            return step
    return None


def hash_recovery(code: str) -> str:
    return hashlib.sha256(code.replace("-", "").strip().lower().encode()).hexdigest()


def verify_second_factor(db, user, code: str) -> bool:
    secret = decrypt_secret(user["totp_secret"])
    if secret:
        step = totp_check(secret, code, user["totp_last"])
        if step:
            db.execute("UPDATE users SET totp_last = ? WHERE id = ?", (step, user["id"]))
            return True
    hashes = json.loads(user["totp_recovery"] or "[]")
    h = hash_recovery(code)
    if h in hashes:
        hashes.remove(h)
        db.execute("UPDATE users SET totp_recovery = ? WHERE id = ?", (json.dumps(hashes), user["id"]))
        return True
    return False


@router.get("/auth/config")
def auth_config(db=Depends(get_db)):
    return {"signup_enabled": settings_get(db, "signup_enabled", "1") == "1",
            "google": bool(settings_get(db, "google_client_id") and settings_get(db, "google_client_secret")),
            "email": email_enabled(db)}


class Mfa(BaseModel):
    mfa_token: str
    code: str


@router.post("/auth/login/2fa")
def login_2fa(b: Mfa, db=Depends(get_db)):
    uid = read_mfa_token(b.mfa_token)
    user = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone() if uid else None
    if not user or user["disabled"]:
        raise HTTPException(401, "That sign-in expired. Start again.")
    if not mfa_limiter.allow(uid):
        raise HTTPException(429, "Too many attempts. Try again in a minute.")
    if not verify_second_factor(db, user, b.code):
        raise HTTPException(401, "That code didn't work")
    db.commit()
    return {"token": make_token(user["id"]), "user": public_user(user)}


# ───────────── manage 2FA for the signed-in user ─────────────
class Code(BaseModel):
    code: str


@router.get("/auth/2fa")
def twofa_status(user=Depends(must_user)):
    return {"enabled": bool(user["totp_enabled"]), "recovery_left": len(json.loads(user["totp_recovery"] or "[]"))}


@router.post("/auth/2fa/setup")
def twofa_setup(user=Depends(must_user), db=Depends(get_db)):
    if user["totp_enabled"]:
        raise HTTPException(409, "Two-factor is already on")
    secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")
    db.execute("UPDATE users SET totp_secret = ? WHERE id = ?", (encrypt_secret(secret), user["id"]))
    db.commit()
    label = urllib.parse.quote(f"{ISSUER}:{user['email']}")
    uri = f"otpauth://totp/{label}?secret={secret}&issuer={ISSUER}&algorithm=SHA1&digits=6&period=30"
    return {"secret": secret, "uri": uri}


@router.post("/auth/2fa/enable")
def twofa_enable(b: Code, user=Depends(must_user), db=Depends(get_db)):
    secret = decrypt_secret(user["totp_secret"])
    if not secret or user["totp_enabled"]:
        raise HTTPException(400, "Start setup first")
    step = totp_check(secret, b.code)
    if not step:
        raise HTTPException(400, "That code didn't match. Check the time on your phone and try again.")
    codes = [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}-{secrets.token_hex(2)}" for _ in range(8)]
    db.execute("UPDATE users SET totp_enabled = 1, totp_last = ?, totp_recovery = ? WHERE id = ?", (step, json.dumps([hash_recovery(c) for c in codes]), user["id"]))
    db.commit()
    return {"recovery_codes": codes}


@router.post("/auth/2fa/disable")
def twofa_disable(b: Code, user=Depends(must_user), db=Depends(get_db)):
    if not user["totp_enabled"]:
        return {"ok": True}
    if not mfa_limiter.allow(user["id"]):
        raise HTTPException(429, "Too many attempts. Try again in a minute.")
    if not verify_second_factor(db, user, b.code):
        raise HTTPException(400, "That code didn't work")
    db.execute("UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_recovery = '[]' WHERE id = ?", (user["id"],))
    db.commit()
    return {"ok": True}


# ───────────── Google sign-in (OAuth 2.0 authorization-code flow) ─────────────
def base_url(request: Request, db) -> str:
    override = settings_get(db, "public_url").rstrip("/")
    if override:
        return override
    proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    host = request.headers.get("x-forwarded-host", request.headers.get("host", "localhost")).split(",")[0].strip()
    return f"{proto}://{host}"


def redirect_uri(request: Request, db) -> str:
    return f"{base_url(request, db)}/api/auth/google/callback"


def google_url(request: Request, db, state: str) -> str:
    cid = settings_get(db, "google_client_id")
    if not cid or not settings_get(db, "google_client_secret"):
        raise HTTPException(404, "Google sign-in isn't set up")
    q = urllib.parse.urlencode({"client_id": cid, "redirect_uri": redirect_uri(request, db), "response_type": "code", "scope": "openid email profile",
                                "state": state, "prompt": "select_account"})
    return f"https://accounts.google.com/o/oauth2/v2/auth?{q}"


@router.get("/auth/google/start")
def google_start(request: Request, next: str = "/", db=Depends(get_db)):
    if not next.startswith("/") or next.startswith("//"):
        next = "/"
    return RedirectResponse(google_url(request, db, make_state(next)))


@router.post("/auth/google/link")
def google_link(request: Request, user=Depends(must_user), db=Depends(get_db)):
    """Returns the Google URL that attaches a Google account to the signed-in user."""
    return {"url": google_url(request, db, make_state("/", link=user["id"]))}


@router.post("/auth/google/unlink")
def google_unlink(user=Depends(must_user), db=Depends(get_db)):
    if not user["pw_set"]:
        raise HTTPException(400, "Set a password first, otherwise you'd be locked out")
    db.execute("UPDATE users SET google_sub = NULL, google_email = NULL WHERE id = ?", (user["id"],))
    db.commit()
    return {"ok": True}


def fail(msg: str, link: bool = False) -> RedirectResponse:
    return RedirectResponse(("/?google=" if link else "/login?error=") + urllib.parse.quote(msg))


@router.get("/auth/google/callback")
def google_callback(request: Request, code: str = "", state: str = "", error: str = "", db=Depends(get_db)):
    if error:
        return fail("Google sign-in was cancelled")
    st = read_state(state)
    next_url, link_uid = st if st else (None, None)
    cid, secret_enc = settings_get(db, "google_client_id"), settings_get(db, "google_client_secret")
    if next_url is None or not code or not cid or not secret_enc:
        return fail("Google sign-in failed. Please try again.")
    try:
        tok = httpx.post("https://oauth2.googleapis.com/token", timeout=15, data={
            "code": code, "client_id": cid, "client_secret": decrypt_secret(secret_enc), "redirect_uri": redirect_uri(request, db), "grant_type": "authorization_code"})
        tok.raise_for_status()
        info = httpx.get("https://openidconnect.googleapis.com/v1/userinfo", timeout=15, headers={"authorization": f"Bearer {tok.json()['access_token']}"}).json()
    except Exception:
        return fail("Couldn't reach Google. Please try again.")
    email = str(info.get("email", "")).lower()
    sub = str(info.get("sub", ""))
    if not sub or not EMAIL_RE.match(email) or not info.get("email_verified"):
        return fail("Your Google email isn't verified", bool(link_uid))
    if link_uid:
        taken = db.execute("SELECT id FROM users WHERE google_sub = ? AND id != ?", (sub, link_uid)).fetchone()
        if taken:
            return fail("That Google account is already linked to another user", True)
        db.execute("UPDATE users SET google_sub = ?, google_email = ? WHERE id = ?", (sub, email, link_uid))
        db.commit()
        return RedirectResponse("/?google=linked")
    user = db.execute("SELECT * FROM users WHERE google_sub = ?", (sub,)).fetchone() or db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if user is None:
        if settings_get(db, "signup_enabled", "1") != "1":
            return fail("Sign-ups are currently closed")
        uid = uuid.uuid4().hex
        db.execute("INSERT INTO users (id, email, name, password_hash, color, created_at, pw_set) VALUES (?,?,?,?,?,?,0)",
                   (uid, email, str(info.get("name") or email.split("@")[0])[:60], hash_password(secrets.token_urlsafe(24)), COLORS[secrets.randbelow(len(COLORS))], time.time()))
        db.commit()
        user = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if user["disabled"]:
        return fail("This account has been suspended")
    if not user["google_sub"]:
        db.execute("UPDATE users SET google_sub = ?, google_email = ? WHERE id = ?", (sub, email, user["id"]))
        db.commit()
    frag = {"next": next_url}
    if user["totp_enabled"]:
        frag["mfa"] = make_mfa_token(user["id"])
    else:
        frag["token"] = make_token(user["id"])
    return RedirectResponse("/auth/callback#" + urllib.parse.urlencode(frag))


# ───────────── change password ─────────────
class PasswordChange(BaseModel):
    current: str = ""
    new: str
    code: str = ""


@router.post("/auth/password")
def change_password(b: PasswordChange, user=Depends(must_user), db=Depends(get_db)):
    if len(b.new) < 8 or len(b.new) > 200:
        raise HTTPException(422, "Use at least 8 characters")
    if not mfa_limiter.allow("pw:" + user["id"]):
        raise HTTPException(429, "Too many attempts. Try again in a minute.")
    if user["pw_set"] and not check_password(b.current, user["password_hash"]):
        raise HTTPException(400, "Your current password is incorrect")
    if user["totp_enabled"] and not verify_second_factor(db, user, b.code):
        raise HTTPException(400, "That two-factor code didn't work")
    db.execute("UPDATE users SET password_hash = ?, pw_set = 1 WHERE id = ?", (hash_password(b.new), user["id"]))
    db.commit()
    return {"ok": True}


# ───────────── delete own account ─────────────
class DeleteAccount(BaseModel):
    email: str
    password: str = ""
    code: str = ""


@router.post("/auth/delete")
async def delete_account(b: DeleteAccount, user=Depends(must_user), db=Depends(get_db)):
    from . import access, quota
    from .collab import refresh_all
    if not mfa_limiter.allow("del:" + user["id"]):
        raise HTTPException(429, "Too many attempts. Try again in a minute.")
    if b.email.strip().lower() != user["email"].lower():
        raise HTTPException(400, "Type your email address exactly to confirm")
    if user["pw_set"] and not check_password(b.password, user["password_hash"]):
        raise HTTPException(400, "Your password is incorrect")
    if user["totp_enabled"] and not verify_second_factor(db, user, b.code):
        raise HTTPException(400, "That two-factor code didn't work")
    if user["email"].lower() in access.admin_emails():
        raise HTTPException(400, "This is a built-in admin account and can't be deleted here")
    quota.drop_uploads(db, "owner_id = ?", (user["id"],))
    db.execute("DELETE FROM users WHERE id = ?", (user["id"],))   # documents, folders, versions, comments, settings cascade
    db.commit()
    await refresh_all()
    return {"ok": True}
