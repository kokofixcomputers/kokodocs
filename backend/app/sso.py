"""Single sign-on with any OAuth 2.0 / OpenID Connect provider. The admin adds providers (Google, GitHub, GitLab, Microsoft and Discord are
just presets; a custom one is a handful of URLs, or an OIDC issuer address that fills them in), and people sign in with, or link, any of them.

Flow: the browser is sent to the provider's authorize URL; the provider sends it back to /api/auth/sso/<id>/callback with a code; we trade the
code for an access token (client secret, server to server) and ask the provider who this is. Identities are kept per provider in
`user_identities`, so the same person can link several. A provider's email is only trusted when it says it is verified (or the admin
has chosen to trust that provider), because accounts are matched by email."""
import json
import re
import secrets
import time
import urllib.parse
import uuid

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from .authx import base_url
from .db import get_db, settings_get
from .routes import COLORS, EMAIL_RE, must_admin, must_user
from .security import ALGO, SECRET, decrypt_secret, encrypt_secret, hash_password, make_mfa_token, make_token

router = APIRouter(prefix="/api")

PRESETS: dict[str, dict] = {
    "google": {"name": "Google", "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth", "token_url": "https://oauth2.googleapis.com/token",
               "userinfo_url": "https://openidconnect.googleapis.com/v1/userinfo", "emails_url": "", "scopes": "openid email profile", "subject_field": "sub",
               "email_field": "email", "name_field": "name", "verified_field": "email_verified", "trust_email": False, "extra_params": {"prompt": "select_account"},
               "hint": "In Google Cloud Console create an OAuth client (type: Web application) and add the redirect address below."},
    "github": {"name": "GitHub", "authorize_url": "https://github.com/login/oauth/authorize", "token_url": "https://github.com/login/oauth/access_token",
               "userinfo_url": "https://api.github.com/user", "emails_url": "https://api.github.com/user/emails", "scopes": "read:user user:email", "subject_field": "id",
               "email_field": "email", "name_field": "name,login", "verified_field": "", "trust_email": False, "extra_params": {},
               "hint": "In GitHub: Settings, Developer settings, OAuth Apps, New OAuth App. Use the redirect address below as the callback URL. The primary verified email is used."},
    "gitlab": {"name": "GitLab", "authorize_url": "https://gitlab.com/oauth/authorize", "token_url": "https://gitlab.com/oauth/token",
               "userinfo_url": "https://gitlab.com/oauth/userinfo", "emails_url": "", "scopes": "openid email profile", "subject_field": "sub", "email_field": "email",
               "name_field": "name,nickname", "verified_field": "email_verified", "trust_email": False, "extra_params": {},
               "hint": "In GitLab: Preferences, Applications. Tick openid, email and profile. For a self-hosted GitLab, replace gitlab.com in the three addresses."},
    "microsoft": {"name": "Microsoft", "authorize_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
                  "userinfo_url": "https://graph.microsoft.com/oidc/userinfo", "emails_url": "", "scopes": "openid email profile", "subject_field": "sub", "email_field": "email",
                  "name_field": "name", "verified_field": "", "trust_email": False, "extra_params": {},
                  "hint": "In Azure: App registrations. Replace “common” in the addresses with your tenant ID to limit it to your organisation, and turn on “Trust the email this provider returns” only if you do (Microsoft doesn't say whether an email is verified)."},
    "discord": {"name": "Discord", "authorize_url": "https://discord.com/oauth2/authorize", "token_url": "https://discord.com/api/oauth2/token",
                "userinfo_url": "https://discord.com/api/users/@me", "emails_url": "", "scopes": "identify email", "subject_field": "id", "email_field": "email",
                "name_field": "global_name,username", "verified_field": "verified", "trust_email": False, "extra_params": {},
                "hint": "In the Discord developer portal create an application, then add the redirect address under OAuth2."},
    "custom": {"name": "Single sign-on", "authorize_url": "", "token_url": "", "userinfo_url": "", "emails_url": "", "scopes": "openid email profile", "subject_field": "sub",
               "email_field": "email", "name_field": "name", "verified_field": "email_verified", "trust_email": False, "extra_params": {},
               "hint": "Any OAuth 2.0 / OpenID Connect provider (Keycloak, Authentik, Okta, Auth0, Zitadel...). Paste its issuer address and press Discover to fill in the addresses."},
}
FIELDS = ("name", "client_id", "authorize_url", "token_url", "userinfo_url", "emails_url", "scopes", "subject_field", "email_field", "name_field", "verified_field")


def ready(p) -> bool:
    return bool(p["enabled"] and p["client_id"] and p["client_secret_enc"] and p["authorize_url"] and p["token_url"] and (p["userinfo_url"] or p["emails_url"]))


def providers(db, only_ready=True):
    rows = db.execute("SELECT * FROM sso_providers ORDER BY position, created_at").fetchall()
    return [r for r in rows if ready(r)] if only_ready else rows


def get_provider(db, pid: str):
    return db.execute("SELECT * FROM sso_providers WHERE id = ?", (pid,)).fetchone()


def redirect_uri(request: Request, db, pid: str) -> str:
    # Google keeps the address people already registered with Google before providers could be added
    return f"{base_url(request, db)}/api/auth/{'google' if pid == 'google' else f'sso/{pid}'}/callback"


# ───────────── the state parameter (guards against forged callbacks) ─────────────
def make_sso_state(pid: str, next_url: str, link: str | None = None) -> str:
    return jwt.encode({"prov": pid, "next": next_url, "link": link, "typ": "sstate", "n": secrets.token_urlsafe(8), "exp": time.time() + 600}, SECRET, ALGO)


def read_sso_state(token: str | None) -> tuple[str, str, str | None] | None:
    try:
        p = jwt.decode(token or "", SECRET, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None
    return (p["prov"], p.get("next", "/"), p.get("link")) if p.get("typ") == "sstate" else None


def authorize_url(request: Request, db, p, state: str) -> str:
    if not ready(p):
        raise HTTPException(404, "That sign-in option isn't set up")
    q = {"client_id": p["client_id"], "redirect_uri": redirect_uri(request, db, p["id"]), "response_type": "code", "scope": p["scopes"] or "openid email profile", "state": state}
    q.update(json.loads(p["extra_params"] or "{}"))
    sep = "&" if "?" in p["authorize_url"] else "?"
    return p["authorize_url"] + sep + urllib.parse.urlencode(q)


@router.get("/auth/sso/{pid}/start")
def sso_start(pid: str, request: Request, next: str = "/", db=Depends(get_db)):
    p = get_provider(db, pid)
    if not p:
        raise HTTPException(404, "That sign-in option isn't set up")
    if not next.startswith("/") or next.startswith("//"):
        next = "/"
    return RedirectResponse(authorize_url(request, db, p, make_sso_state(pid, next)))


@router.post("/auth/sso/{pid}/link")
def sso_link(pid: str, request: Request, user=Depends(must_user), db=Depends(get_db)):
    p = get_provider(db, pid)
    if not p:
        raise HTTPException(404, "That sign-in option isn't set up")
    return {"url": authorize_url(request, db, p, make_sso_state(pid, "/", link=user["id"]))}


@router.post("/auth/sso/{pid}/unlink")
def sso_unlink(pid: str, user=Depends(must_user), db=Depends(get_db)):
    others = db.execute("SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ? AND provider != ?", (user["id"], pid)).fetchone()["n"]
    if not user["pw_set"] and not others:
        raise HTTPException(400, "Set a password first, otherwise you'd be locked out")
    db.execute("DELETE FROM user_identities WHERE user_id = ? AND provider = ?", (user["id"], pid))
    db.commit()
    return {"ok": True}


@router.get("/auth/sso/identities")
def my_identities(user=Depends(must_user), db=Depends(get_db)):
    rows = db.execute("SELECT i.provider, i.label, p.name FROM user_identities i LEFT JOIN sso_providers p ON p.id = i.provider WHERE i.user_id = ?", (user["id"],)).fetchall()
    return [{"provider": r["provider"], "name": r["name"] or r["provider"], "label": r["label"]} for r in rows]


# ───────────── reading who the provider says this is ─────────────
def pick(info, spec: str):
    """The first present value among comma-separated field names; a dotted name looks inside nested objects (`address.email`)."""
    for name in [s.strip() for s in (spec or "").split(",") if s.strip()]:
        v = info
        for part in name.split("."):
            v = v.get(part) if isinstance(v, dict) else None
        if v not in (None, ""):
            return v
    return None


def truthy(v) -> bool:
    return v is True or str(v).lower() in ("true", "1", "yes")


def who(p, info: dict, emails: list | None) -> tuple[str, str, bool, str]:
    """(subject, email, email is verified, display name)"""
    sub = pick(info, p["subject_field"])
    email = str(pick(info, p["email_field"]) or "").lower()
    verified = False
    vf = (p["verified_field"] or "").strip()
    if email and vf and pick(info, vf) is not None:
        verified = truthy(pick(info, vf))
    if emails is not None and not (email and verified):   # GitHub style: a list of {email, primary, verified}
        good = [e for e in emails if isinstance(e, dict) and e.get("email") and truthy(e.get("verified", True))]
        good.sort(key=lambda e: not truthy(e.get("primary")))
        if good:
            email, verified = str(good[0]["email"]).lower(), True
    if email and not verified and p["trust_email"]:
        verified = True
    name = str(pick(info, p["name_field"]) or (email.split("@")[0] if email else "") or "")
    return ("" if sub is None else str(sub)), email, verified, name


def fetch_identity(request: Request, db, p, code: str) -> tuple[str, str, bool, str]:
    data = {"code": code, "grant_type": "authorization_code", "redirect_uri": redirect_uri(request, db, p["id"])}
    auth = None
    secret = decrypt_secret(p["client_secret_enc"])
    if p["auth_method"] == "basic":
        auth = (p["client_id"], secret or "")
    else:
        data.update({"client_id": p["client_id"], "client_secret": secret})
    tok = httpx.post(p["token_url"], data=data, auth=auth, timeout=15, headers={"Accept": "application/json"})
    tok.raise_for_status()
    access = tok.json()["access_token"]
    h = {"Authorization": f"Bearer {access}", "Accept": "application/json"}
    info = httpx.get(p["userinfo_url"], timeout=15, headers=h).json() if p["userinfo_url"] else {}
    emails = None
    if p["emails_url"]:
        try:
            r = httpx.get(p["emails_url"], timeout=15, headers=h)
            emails = r.json() if r.status_code == 200 and isinstance(r.json(), list) else None
        except Exception:
            emails = None
    return who(p, info if isinstance(info, dict) else {}, emails)


def fail(msg: str, link: bool = False) -> RedirectResponse:
    return RedirectResponse(("/?sso=" if link else "/login?error=") + urllib.parse.quote(msg))


def finish(request: Request, db, pid: str, code: str, state: str, error: str):
    p = get_provider(db, pid)
    name = p["name"] if p else "That provider"
    if error:
        return fail(f"{name} sign-in was cancelled")
    st = read_sso_state(state)
    if not p or not st or st[0] != pid or not code or not ready(p):
        return fail(f"{name} sign-in failed. Please try again.")
    _, next_url, link_uid = st
    try:
        sub, email, verified, display = fetch_identity(request, db, p, code)
    except Exception:
        return fail(f"Couldn't reach {name}. Please try again.", bool(link_uid))
    if not sub:
        return fail(f"{name} didn't say who you are", bool(link_uid))
    label = email or display or sub
    if link_uid:
        taken = db.execute("SELECT user_id FROM user_identities WHERE provider = ? AND subject = ? AND user_id != ?", (pid, sub, link_uid)).fetchone()
        if taken:
            return fail(f"That {name} account is already linked to another user", True)
        db.execute("INSERT INTO user_identities (provider, subject, user_id, label, created_at) VALUES (?,?,?,?,?) ON CONFLICT(provider, subject) DO UPDATE SET label = excluded.label",
                   (pid, sub, link_uid, label, time.time()))
        db.commit()
        return RedirectResponse("/?sso=linked:" + urllib.parse.quote(name))
    row = db.execute("SELECT user_id FROM user_identities WHERE provider = ? AND subject = ?", (pid, sub)).fetchone()
    user = db.execute("SELECT * FROM users WHERE id = ?", (row["user_id"],)).fetchone() if row else None
    if user is None:
        if not EMAIL_RE.match(email) or not verified:
            return fail(f"Your {name} email isn't verified")
        user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()   # someone with that (verified) email already has an account
    if user is None:
        if settings_get(db, "signup_enabled", "1") != "1":
            return fail("Sign-ups are currently closed")
        uid = uuid.uuid4().hex
        db.execute("INSERT INTO users (id, email, name, password_hash, color, created_at, pw_set) VALUES (?,?,?,?,?,?,0)",
                   (uid, email, (display or email.split("@")[0])[:60], hash_password(secrets.token_urlsafe(24)), COLORS[secrets.randbelow(len(COLORS))], time.time()))
        db.commit()
        user = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if user["disabled"]:
        return fail("This account has been suspended")
    if not row:
        db.execute("INSERT OR IGNORE INTO user_identities (provider, subject, user_id, label, created_at) VALUES (?,?,?,?,?)", (pid, sub, user["id"], label, time.time()))
        db.commit()
    frag = {"next": next_url}
    if user["totp_enabled"]:
        frag["mfa"] = make_mfa_token(user["id"])
    else:
        frag["token"] = make_token(user["id"])
    return RedirectResponse("/auth/callback#" + urllib.parse.urlencode(frag))


@router.get("/auth/sso/{pid}/callback")
def sso_callback(pid: str, request: Request, code: str = "", state: str = "", error: str = "", db=Depends(get_db)):
    return finish(request, db, pid, code, state, error)


@router.get("/auth/google/callback")
def google_callback(request: Request, code: str = "", state: str = "", error: str = "", db=Depends(get_db)):
    return finish(request, db, "google", code, state, error)


# ───────────── admin: add, edit and remove providers ─────────────
def view(request: Request, db, p) -> dict:
    n = db.execute("SELECT COUNT(*) AS n FROM user_identities WHERE provider = ?", (p["id"],)).fetchone()["n"]
    return {"id": p["id"], "preset": p["preset"], "enabled": bool(p["enabled"]), "ready": ready(p), "secret_set": bool(p["client_secret_enc"]), "linked": n,
            "redirect_uri": redirect_uri(request, db, p["id"]), "trust_email": bool(p["trust_email"]), "auth_method": p["auth_method"],
            **{k: p[k] for k in FIELDS}}


class NewProvider(BaseModel):
    preset: str


class ProviderIn(BaseModel):
    name: str | None = Field(None, max_length=60)
    client_id: str | None = Field(None, max_length=300)
    client_secret: str | None = Field(None, max_length=500)
    authorize_url: str | None = Field(None, max_length=500)
    token_url: str | None = Field(None, max_length=500)
    userinfo_url: str | None = Field(None, max_length=500)
    emails_url: str | None = Field(None, max_length=500)
    scopes: str | None = Field(None, max_length=300)
    subject_field: str | None = Field(None, max_length=100)
    email_field: str | None = Field(None, max_length=100)
    name_field: str | None = Field(None, max_length=100)
    verified_field: str | None = Field(None, max_length=100)
    trust_email: bool | None = None
    auth_method: str | None = Field(None, pattern="^(post|basic)$")
    enabled: bool | None = None


@router.get("/admin/sso")
def admin_list(request: Request, admin=Depends(must_admin), db=Depends(get_db)):
    return {"providers": [view(request, db, p) for p in providers(db, only_ready=False)], "public_url": settings_get(db, "public_url"),
            "presets": [{"id": k, "name": v["name"], "hint": v["hint"]} for k, v in PRESETS.items()]}


@router.post("/admin/sso")
def admin_add(b: NewProvider, request: Request, admin=Depends(must_admin), db=Depends(get_db)):
    pre = PRESETS.get(b.preset)
    if not pre:
        raise HTTPException(422, "Unknown preset")
    base = b.preset if b.preset != "custom" else "sso"
    pid, n = base, 1
    while get_provider(db, pid):
        n += 1
        pid = f"{base}-{n}"
    pos = db.execute("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM sso_providers").fetchone()["p"]
    db.execute("""INSERT INTO sso_providers (id, preset, name, client_id, client_secret_enc, authorize_url, token_url, userinfo_url, emails_url, scopes, subject_field, email_field,
                  name_field, verified_field, trust_email, auth_method, extra_params, enabled, position, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
               (pid, b.preset, pre["name"], "", None, pre["authorize_url"], pre["token_url"], pre["userinfo_url"], pre["emails_url"], pre["scopes"], pre["subject_field"], pre["email_field"],
                pre["name_field"], pre["verified_field"], int(pre["trust_email"]), "post", json.dumps(pre["extra_params"]), 1, pos, time.time()))
    db.commit()
    return view(request, db, get_provider(db, pid))


def need_url(v: str, what: str) -> str:
    v = v.strip()
    if v and not re.match(r"^https?://[^\s]+$", v):
        raise HTTPException(422, f"The {what} must be a full address starting with http:// or https://")
    return v


@router.put("/admin/sso/{pid}")
def admin_edit(pid: str, b: ProviderIn, request: Request, admin=Depends(must_admin), db=Depends(get_db)):
    p = get_provider(db, pid)
    if not p:
        raise HTTPException(404, "No such provider")
    sets: dict = {}
    for k in ("name", "client_id", "scopes", "subject_field", "email_field", "name_field", "verified_field"):
        v = getattr(b, k)
        if v is not None:
            sets[k] = v.strip()
    for k, label in (("authorize_url", "authorize address"), ("token_url", "token address"), ("userinfo_url", "user info address"), ("emails_url", "emails address")):
        v = getattr(b, k)
        if v is not None:
            sets[k] = need_url(v, label)
    if sets.get("name") == "":
        raise HTTPException(422, "Give it a name")
    if sets.get("subject_field") == "":
        raise HTTPException(422, "Say which field identifies the person (usually sub or id)")
    if b.client_secret is not None and b.client_secret.strip():
        sets["client_secret_enc"] = encrypt_secret(b.client_secret.strip())
    if b.trust_email is not None:
        sets["trust_email"] = int(b.trust_email)
    if b.auth_method is not None:
        sets["auth_method"] = b.auth_method
    if b.enabled is not None:
        sets["enabled"] = int(b.enabled)
    if sets:
        db.execute(f"UPDATE sso_providers SET {', '.join(k + ' = ?' for k in sets)} WHERE id = ?", (*sets.values(), pid))
        db.commit()
    return view(request, db, get_provider(db, pid))


@router.delete("/admin/sso/{pid}")
def admin_delete(pid: str, admin=Depends(must_admin), db=Depends(get_db)):
    db.execute("DELETE FROM user_identities WHERE provider = ?", (pid,))
    db.execute("DELETE FROM sso_providers WHERE id = ?", (pid,))
    db.commit()
    return {"ok": True}


class Discover(BaseModel):
    issuer: str = Field(max_length=500)


@router.post("/admin/sso/discover")
def admin_discover(b: Discover, admin=Depends(must_admin)):
    """Fill in the addresses from an OpenID Connect issuer (its /.well-known/openid-configuration)."""
    issuer = need_url(b.issuer, "issuer address").rstrip("/")
    if not issuer:
        raise HTTPException(422, "Enter the provider's issuer address, like https://auth.example.com/realms/main")
    url = issuer if issuer.endswith("openid-configuration") else issuer + "/.well-known/openid-configuration"
    try:
        r = httpx.get(url, timeout=15, headers={"Accept": "application/json"}, follow_redirects=True)
        r.raise_for_status()
        c = r.json()
    except Exception:
        raise HTTPException(502, "Couldn't read that provider's configuration. Check the address, or fill the addresses in by hand.")
    if not isinstance(c, dict) or not c.get("authorization_endpoint") or not c.get("token_endpoint"):
        raise HTTPException(502, "That address doesn't look like an OpenID Connect provider")
    return {"authorize_url": c["authorization_endpoint"], "token_url": c["token_endpoint"], "userinfo_url": c.get("userinfo_endpoint", ""),
            "scopes": "openid email profile", "name": c.get("issuer", "")}
