"""Forms: the form itself is a collaboratively edited Yjs document; people who can view it fill it out.

Yjs layout (see frontend/src/forms/model.ts):
  meta   Map    title, description, accepting, requireLogin, oneResponse, confirmation
  order  Array  item ids, top to bottom
  items  Map    id -> plain JSON item {type, title, help, required, options, ...}
Anyone who can open the form (a shared person or anyone with the link) can submit; only editors see responses.
"""
import json
import os
import random
import re
import time
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from urllib.parse import quote
from pycrdt import Array, Doc, Map

from . import access, collab, quota
from .db import FORM_FILES_DIR, connect, get_db
from .routes import ctx
from .security import RateLimiter

router = APIRouter(prefix="/api")
submit_limiter = RateLimiter(int(os.environ.get("KOKO_FORM_RATE", "20")), 60)

ANSWER_TYPES = {"color", "file", "short", "long", "number", "email", "url", "date", "time", "radio", "checkbox", "select", "scale"}
MAX_ITEMS = 200
MAX_TEXT = 10_000
MAX_RESPONSES = 20_000
MAX_FILE = 3 * 1024 * 1024          # hard ceiling for any uploaded file; a question can lower it
MAX_PENDING = 200                   # uploaded but not yet submitted, per form
STALE_AFTER = 24 * 3600
upload_limiter = RateLimiter(int(os.environ.get("KOKO_FORM_UPLOAD_RATE", "12")), 60)
FILE_ID = re.compile(r"^[0-9a-f]{32}$")
# what each "allowed files" choice accepts (extension, plus a content check where the format has a clear signature)
ACCEPT = {
    "images": {"png", "jpg", "jpeg", "gif", "webp"},
    "pdf": {"pdf"},
    "docs": {"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "txt", "csv", "md", "rtf"},
}
# files that run on the owner's computer when opened: never accepted, whatever the question allows
DENY = {"exe", "msi", "bat", "cmd", "com", "scr", "pif", "cpl", "dll", "sys", "jar", "js", "mjs", "vbs", "vbe", "wsf", "wsh", "ps1", "psm1", "sh", "bash",
        "zsh", "command", "app", "dmg", "pkg", "apk", "ipa", "lnk", "hta", "reg", "inf", "php", "py", "pl", "rb", "cgi", "html", "htm", "xhtml", "svg", "swf"}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
URL_RE = re.compile(r"^https?://[^\s/$.?#][^\s]*$", re.I)
NESTED_QUANT = re.compile(r"\([^)]*[+*][^)]*\)\s*[+*{]")   # (a+)+ style patterns: refuse, they can hang the server


def _plain(v):
    if hasattr(v, "to_py"):
        return v.to_py()
    return v


def parse_form(doc: Doc) -> dict:
    meta_map = doc.get("meta", type=Map)
    meta = {k: _plain(meta_map.get(k)) for k in meta_map.keys()}
    order = [str(i) for i in doc.get("order", type=Array)]
    items_map = doc.get("items", type=Map)
    items = []
    for iid in order:
        raw = _plain(items_map.get(iid))
        if isinstance(raw, dict):
            if raw.get("type") == "media":   # never hand out a javascript:/data: link, whatever an editor typed
                src = str(raw.get("src") or "")
                if not (re.match(r"^https?://\S+$", src) or re.match(r"^/api/images/[0-9a-f]{32}\.(png|jpg|gif|webp)$", src)) or len(src) > 2000:
                    raw = {**raw, "src": ""}
            items.append({**raw, "id": iid})
    return {"meta": meta, "items": items[:MAX_ITEMS]}


def load_schema(doc_id: str) -> dict:
    room = collab.rooms.get(doc_id)
    if room:
        return parse_form(room.doc)
    d = Doc()
    with connect() as db:
        from .extstore import service as ext
        ext.ensure_local(db, doc_id)
        row = db.execute("SELECT ydoc FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if row and row["ydoc"]:
        d.apply_update(bytes(row["ydoc"]))
    return parse_form(d)


def public_schema(doc, schema: dict) -> dict:
    m = schema["meta"]
    return {
        "title": doc["title"],
        "description": m.get("description") or "",
        "accent": m.get("accent") if isinstance(m.get("accent"), str) and re.fullmatch(r"#[0-9a-fA-F]{6}", m.get("accent")) else "",
        "accepting": m.get("accepting") is not False,
        "requireLogin": bool(m.get("requireLogin")),
        "oneResponse": bool(m.get("oneResponse")),
        "confirmation": m.get("confirmation") or "",
        "items": schema["items"],
    }


def need_form(db, doc_id, c, minimum="viewer"):
    doc, acc = access.require(db, doc_id, *c, minimum=minimum)
    if doc["kind"] != "form":
        raise HTTPException(404, "Not a form")
    return doc, acc


# ───────────── validation (mirrors frontend/src/forms/validate.ts) ─────────────
def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _bound(v, default=None):
    n = _num(v)
    return default if n is None else n


def check_item(it: dict, val) -> tuple[object, str | None]:
    """(clean value or None when blank, error message or None)."""
    t = it.get("type")
    required = bool(it.get("required"))
    opts = [o for o in it.get("options", []) if isinstance(o, str)]
    other = bool(it.get("other"))
    blank = val is None or val == "" or val == []
    if blank:
        return None, ("This question is required" if required else None)
    if t == "color":   # a hex colour like #1f6feb, stored in lower case
        c = str(val).strip() if isinstance(val, str) else ""
        return (c.lower(), None) if re.fullmatch(r"#[0-9a-fA-F]{6}", c) else (None, "Pick a colour")
    if t == "file":   # the value is the id of a file uploaded earlier; submit() checks it really is theirs
        return (val, None) if isinstance(val, str) and FILE_ID.match(val) else (None, "Upload the file again")
    if t in ("radio", "select", "scale"):
        if isinstance(val, (int, float)) and t == "scale":
            val = str(int(val))
        if not isinstance(val, str) or len(val) > 500:
            return None, "Choose an option"
        if t == "scale":
            lo, hi = int(_bound(it.get("scaleMin"), 1)), int(_bound(it.get("scaleMax"), 5))
            if not val.lstrip("-").isdigit() or not lo <= int(val) <= hi:
                return None, "Choose a value on the scale"
        elif val not in opts and not (other and t == "radio"):
            return None, "Choose one of the options"
        return val, None
    if t == "checkbox":
        if not isinstance(val, list) or not all(isinstance(x, str) and len(x) <= 500 for x in val) or len(val) > 200:
            return None, "Choose from the options"
        val = list(dict.fromkeys(val))
        if any(x not in opts for x in val) and not other:
            return None, "Choose from the options"
        lo, hi = _bound(it.get("minSel")), _bound(it.get("maxSel"))
        if lo and len(val) < lo:
            return None, f"Choose at least {int(lo)}"
        if hi and len(val) > hi:
            return None, f"Choose at most {int(hi)}"
        return val, None
    if not isinstance(val, (str, int, float)) or isinstance(val, bool):
        return None, "Invalid answer"
    s = str(val).strip()
    if not s:
        return None, ("This question is required" if required else None)
    if len(s) > MAX_TEXT:
        return None, "That answer is too long"
    if t == "number":
        n = _num(s)
        if n is None or n != n or n in (float("inf"), float("-inf")):
            return None, "Enter a number"
        if it.get("integer") and n != int(n):
            return None, "Enter a whole number"
        lo, hi = _bound(it.get("min")), _bound(it.get("max"))
        if lo is not None and n < lo:
            return None, f"Must be at least {it.get('min')}"
        if hi is not None and n > hi:
            return None, f"Must be at most {it.get('max')}"
        return s, None
    if t == "email" and not EMAIL_RE.match(s):
        return None, "Enter a valid email address"
    if t == "url" and not URL_RE.match(s):
        return None, "Enter a valid link starting with http:// or https://"
    if t in ("date", "time"):
        try:
            d = date.fromisoformat(s) if t == "date" else datetime.strptime(s, "%H:%M")
        except ValueError:
            return None, "Enter a valid " + t
        if t == "date":
            for key, msg in (("min", "on or after"), ("max", "on or before")):
                lim = it.get(key)
                try:
                    lim_d = date.fromisoformat(lim) if isinstance(lim, str) and lim else None
                except ValueError:
                    lim_d = None
                if lim_d and (d < lim_d if key == "min" else d > lim_d):
                    return None, f"Must be {msg} {lim}"
        return s, None
    if t in ("short", "long", "email", "url"):
        lo, hi = _bound(it.get("minLen")), _bound(it.get("maxLen"))
        if lo and len(s) < lo:
            return None, f"Use at least {int(lo)} characters"
        if hi and len(s) > hi:
            return None, f"Use at most {int(hi)} characters"
        pat = it.get("pattern")
        if isinstance(pat, str) and pat and len(pat) <= 200 and not NESTED_QUANT.search(pat) and len(s) <= 2000:
            try:
                if not re.search(pat, s):
                    return None, it.get("patternMsg") or "That doesn't match the expected format"
            except re.error:
                pass
    return s, None


def _blank(v) -> bool:
    return v is None or v == "" or v == [] or (isinstance(v, str) and not v.strip())


def rule_holds(rule: dict, answer) -> bool:
    op, v, b = rule.get("op"), str(rule.get("v") or ""), _blank(answer)
    if op == "filled":
        return not b
    if op == "empty":
        return b
    if op == "is":
        return not b and (v in answer if isinstance(answer, list) else str(answer) == v)
    if op == "isnot":
        return b or (v not in answer if isinstance(answer, list) else str(answer) != v)
    if op == "contains":
        if b:
            return False
        low = v.lower()
        return any(low in str(a).lower() for a in answer) if isinstance(answer, list) else low in str(answer).lower()
    if op in ("gt", "lt"):
        if b or isinstance(answer, (list, dict)) or not v.strip():
            return False
        x, y = _num(answer), _num(v)
        if x is None or y is None or x != x or y != y:
            return False
        return x > y if op == "gt" else x < y
    return True


def compute_flow(items: list[dict], answers: dict) -> set[str]:
    """Ids of the questions this person actually saw (mirrors frontend/src/forms/flow.ts).
    Hidden questions and pages skipped by logic are never required and their answers are dropped."""
    pages: list[dict] = [{"head": None, "items": []}]
    for it in items:
        if it.get("type") == "page":
            pages.append({"head": it, "items": []})
        else:
            pages[-1]["items"].append(it)
    ids = {it["id"] for it in items}
    visible: set[str] = set()

    def holds(it: dict) -> bool:
        s = it.get("showIf")
        rules = s.get("rules") if isinstance(s, dict) else None
        if not isinstance(rules, list) or not rules:
            return True
        live = [r for r in rules if isinstance(r, dict) and r.get("q") in ids]
        if not live:
            return True
        res = [rule_holds(r, answers.get(r["q"]) if r["q"] in visible else None) for r in live]
        return any(res) if s.get("match") == "any" else all(res)

    i = 0
    while i < len(pages):
        page = pages[i]
        if i > 0 and page["head"] is not None and not holds(page["head"]):
            i += 1
            continue
        shown = []
        for it in page["items"]:
            if holds(it):
                visible.add(it["id"])
                shown.append(it)
        if i > 0 and page["items"] and not shown:
            i += 1
            continue
        nxt = i + 1
        for it in shown:
            if it.get("type") not in ("radio", "select"):
                continue
            a = answers.get(it["id"])
            jumps = it.get("jumps")
            target = jumps.get(a) if isinstance(a, str) and isinstance(jumps, dict) else None
            if not target:
                continue
            if target == "submit":
                nxt = len(pages)
            else:
                j = next((k for k, p in enumerate(pages) if p["head"] is not None and p["head"]["id"] == target), -1)
                if j > i:
                    nxt = j
            break
        i = nxt
    return visible


def validate_all(items: list[dict], answers: dict) -> tuple[dict, dict]:
    clean, errors = {}, {}
    seen = compute_flow(items, answers)
    for it in items:
        if it.get("type") not in ANSWER_TYPES or it["id"] not in seen:
            continue
        v, err = check_item(it, answers.get(it["id"]))
        if err:
            errors[it["id"]] = err
        elif v is not None:
            clean[it["id"]] = v
    return clean, errors


# ───────────── endpoints ─────────────
@router.get("/forms/{doc_id}")
def get_form(doc_id: str, c=Depends(ctx), db=Depends(get_db)):
    doc, acc = need_form(db, doc_id, c)
    out = public_schema(doc, load_schema(doc_id))
    out["role"] = acc.role
    out["submitted"] = bool(acc.user and db.execute("SELECT 1 FROM form_responses WHERE form_id = ? AND user_id = ?", (doc_id, acc.user["id"])).fetchone())
    return out


@router.post("/forms/{doc_id}/responses")
async def submit(doc_id: str, request: Request, body: dict, c=Depends(ctx), db=Depends(get_db)):
    doc, acc = need_form(db, doc_id, c)
    who = acc.user["id"] if acc.user else (request.client.host if request.client else "?")
    if not submit_limiter.allow(f"form:{who}:{doc_id}"):
        raise HTTPException(429, "Too many submissions. Try again in a minute.")
    form = public_schema(doc, load_schema(doc_id))
    if not form["accepting"]:
        raise HTTPException(403, {"code": "closed", "message": "This form is no longer accepting responses"})
    if (form["requireLogin"] or form["oneResponse"]) and not acc.user:
        raise HTTPException(401, {"code": "login_required", "message": "Sign in to submit this form"})
    if form["oneResponse"] and db.execute("SELECT 1 FROM form_responses WHERE form_id = ? AND user_id = ?", (doc_id, acc.user["id"])).fetchone():
        raise HTTPException(409, {"code": "already", "message": "You have already responded to this form"})
    answers = body.get("answers")
    if not isinstance(answers, dict):
        raise HTTPException(422, "Missing answers")
    clean, errors = validate_all(form["items"], answers)
    if errors:
        return JSONResponse({"detail": {"code": "invalid", "message": "Some answers need fixing", "errors": errors}}, status_code=422)
    if db.execute("SELECT COUNT(*) AS n FROM form_responses WHERE form_id = ?", (doc_id,)).fetchone()["n"] >= MAX_RESPONSES:
        raise HTTPException(403, "This form has reached its response limit")
    file_ids: list[str] = []
    for it in form["items"]:
        if it.get("type") == "file" and it["id"] in clean:
            row = db.execute("SELECT id FROM form_files WHERE id = ? AND form_id = ? AND item_id = ? AND response_id IS NULL", (clean[it["id"]], doc_id, it["id"])).fetchone()
            if not row:
                errors[it["id"]] = "Upload the file again"
            else:
                file_ids.append(row["id"])
    if errors:
        return JSONResponse({"detail": {"code": "invalid", "message": "Some answers need fixing", "errors": errors}}, status_code=422)
    rid = uuid.uuid4().hex[:16]
    u = acc.user
    db.execute("INSERT INTO form_responses (id, form_id, user_id, user_name, user_email, data, created_at) VALUES (?,?,?,?,?,?,?)",
               (rid, doc_id, u["id"] if u else None, u["name"] if u else None, u["email"] if u else None, json.dumps(clean), time.time()))
    for fid in file_ids:
        db.execute("UPDATE form_files SET response_id = ? WHERE id = ?", (rid, fid))
    db.commit()
    return {"ok": True, "id": rid}


@router.get("/forms/{doc_id}/responses")
def list_responses(doc_id: str, c=Depends(ctx), db=Depends(get_db)):
    doc, _ = need_form(db, doc_id, c, "editor")
    rows = db.execute("SELECT * FROM form_responses WHERE form_id = ? ORDER BY created_at DESC LIMIT 5000", (doc_id,)).fetchall()
    files = {f["id"]: {"id": f["id"], "name": f["name"], "size": f["size"]} for f in db.execute("SELECT id, name, size FROM form_files WHERE form_id = ? AND response_id IS NOT NULL", (doc_id,))}
    items = load_schema(doc_id)["items"]
    file_items = {i["id"] for i in items if i.get("type") == "file"}
    out = []
    for r in rows:
        a = json.loads(r["data"])
        for k in file_items & a.keys():
            a[k] = files.get(a[k], {"id": "", "name": "(deleted file)", "size": 0})   # the answer is a file id; show what it points at
        out.append({"id": r["id"], "created_at": r["created_at"], "name": r["user_name"], "email": r["user_email"], "answers": a})
    return {"items": items, "responses": out}


@router.delete("/forms/{doc_id}/responses/{rid}")
def delete_response(doc_id: str, rid: str, c=Depends(ctx), db=Depends(get_db)):
    need_form(db, doc_id, c, "editor")
    remove_files(db, "form_id = ? AND response_id = ?", (doc_id, rid))
    db.execute("DELETE FROM form_responses WHERE id = ? AND form_id = ?", (rid, doc_id))
    return {"ok": True}


@router.delete("/forms/{doc_id}/responses")
def clear_responses(doc_id: str, c=Depends(ctx), db=Depends(get_db)):
    need_form(db, doc_id, c, "editor")
    remove_files(db, "form_id = ? AND response_id IS NOT NULL", (doc_id,))
    db.execute("DELETE FROM form_responses WHERE form_id = ?", (doc_id,))
    return {"ok": True}


# ───────────── file uploads ─────────────
def remove_files(db, where: str, args: tuple = ()) -> None:
    """Delete uploaded files (disk and rows) matching a form_files condition."""
    for f in db.execute(f"SELECT stored FROM form_files WHERE {where}", args).fetchall():
        try:
            (FORM_FILES_DIR / f["stored"]).unlink(missing_ok=True)
        except OSError:
            pass
    db.execute(f"DELETE FROM form_files WHERE {where}", args)


def sweep_stale() -> None:
    """Uploaded but never submitted for a day: remove them so abandoned forms don't eat the owner's storage."""
    with connect() as db:
        remove_files(db, "response_id IS NULL AND created_at < ?", (time.time() - STALE_AFTER,))


def start_sweeper() -> None:
    import threading

    def loop():
        while True:
            try:
                sweep_stale()
            except Exception:
                pass
            time.sleep(3600)
    threading.Thread(target=loop, daemon=True).start()


def clean_name(raw: str | None) -> str:
    n = re.sub(r"[\x00-\x1f\x7f/\\:*?\"<>|]+", "_", (raw or "file").replace("\\", "/").split("/")[-1]).strip(" .") or "file"
    return n[:120]


def looks_real(ext: str, data: bytes) -> bool:
    """Formats with a clear signature must really be that format (stops a renamed file passing as an image or PDF)."""
    if ext == "png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if ext in ("jpg", "jpeg"):
        return data.startswith(b"\xff\xd8\xff")
    if ext == "gif":
        return data.startswith(b"GIF8")
    if ext == "webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    if ext == "pdf":
        return data.startswith(b"%PDF")
    return True


PRESET_TEXT = {"images": "images (PNG, JPEG, GIF, WebP)", "pdf": "PDF files", "docs": "documents, spreadsheets, presentations, PDFs and text files"}


def file_problem(item: dict, name: str, data: bytes) -> str | None:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if not data:
        return "That file is empty"
    mb = item.get("maxMB")
    limit = min(MAX_FILE, int(max(0.1, float(mb)) * 1024 * 1024)) if isinstance(mb, (int, float)) and not isinstance(mb, bool) else MAX_FILE
    if len(data) > limit:
        return f"That file is larger than {limit / (1024 * 1024):g} MB"
    if ext in DENY:
        return "That kind of file isn't allowed"
    preset = item.get("accept")
    if preset in ACCEPT:
        if ext not in ACCEPT[preset]:
            return "This question accepts " + PRESET_TEXT[preset]
        if not looks_real(ext, data):
            return f"That file doesn't look like a real .{ext}"
    return None


@router.post("/forms/{doc_id}/files")
async def upload_file(doc_id: str, request: Request, item: str = Form(...), file: UploadFile = File(...), c=Depends(ctx), db=Depends(get_db)):
    """A person filling the form attaches a file to a file question. It counts toward the form owner's storage until the response is deleted."""
    doc, acc = need_form(db, doc_id, c)
    who = acc.user["id"] if acc.user else (request.client.host if request.client else "?")
    if not upload_limiter.allow(f"formfile:{who}:{doc_id}"):
        raise HTTPException(429, "Too many uploads. Try again in a minute.")
    form = public_schema(doc, load_schema(doc_id))
    if not form["accepting"]:
        raise HTTPException(403, {"code": "closed", "message": "This form is no longer accepting responses"})
    if (form["requireLogin"] or form["oneResponse"]) and not acc.user:
        raise HTTPException(401, {"code": "login_required", "message": "Sign in to submit this form"})
    q = next((i for i in form["items"] if i["id"] == item and i.get("type") == "file"), None)
    if not q:
        raise HTTPException(404, "That question doesn't take files")
    data = await file.read(MAX_FILE + 1)
    name = clean_name(file.filename)
    problem = file_problem(q, name, data)
    if problem:
        raise HTTPException(413 if "larger" in problem else 415, problem)
    if random.random() < 0.05:
        sweep_stale()
    if db.execute("SELECT COUNT(*) FROM form_files WHERE form_id = ? AND response_id IS NULL", (doc_id,)).fetchone()[0] >= MAX_PENDING:
        raise HTTPException(429, "Too many uploads are waiting on this form. Try again later.")
    try:
        quota.check(db, doc["owner_id"], len(data))
    except HTTPException:
        raise HTTPException(507, "This form can't accept files right now. Please tell its owner.")   # never reveal the owner's quota to a stranger
    fid = uuid.uuid4().hex
    stored = uuid.uuid4().hex
    (FORM_FILES_DIR / stored).write_bytes(data)   # random name, no extension: never served or run as anything
    db.execute("INSERT INTO form_files (id, form_id, item_id, name, size, stored, created_at) VALUES (?,?,?,?,?,?,?)", (fid, doc_id, item, name, len(data), stored, time.time()))
    db.commit()
    return {"id": fid, "name": name, "size": len(data)}


@router.get("/forms/{doc_id}/files/{fid}")
def download_file(doc_id: str, fid: str, c=Depends(ctx), db=Depends(get_db)):
    """Only people who can edit the form can download what was submitted. Always an attachment, never displayed in the browser."""
    need_form(db, doc_id, c, "editor")
    if not FILE_ID.match(fid):
        raise HTTPException(404)
    row = db.execute("SELECT name, stored, remote FROM form_files WHERE id = ? AND form_id = ? AND response_id IS NOT NULL", (fid, doc_id)).fetchone()
    path = FORM_FILES_DIR / row["stored"] if row else None
    if row and row["remote"] and not path.exists():   # kept in the form owner's own storage
        from .extstore import service as ext
        owner = db.execute("SELECT owner_id FROM documents WHERE id = ?", (doc_id,)).fetchone()["owner_id"]
        data = ext.fetch_file(db, owner, "form", row["stored"])
        if data is None:
            raise HTTPException(404, "File not found")
        return Response(data, media_type="application/octet-stream", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(row['name'])}", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "sandbox"})
    if not row or not path.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(path, filename=row["name"], media_type="application/octet-stream", headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "sandbox"})
