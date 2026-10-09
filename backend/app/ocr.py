"""Reading text from a photo of a page with a vision model (the "AI provider" choice in Scan a page).

The other choice, reading it on the person's own device, never reaches the server at all. Here the picture is relayed to a model that can see
pictures (any OpenAI-compatible one, or Mistral's dedicated OCR model) with an instruction to reply with only the text in the image, and the
text comes back. Nothing is stored. The administrator chooses which model reads pictures, and can edit the instruction (admin panel, Scan a page)."""
import base64
import json
import re
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .ai import CF_NATIVE, CONNECT_TIMEOUT, READ_TIMEOUT, available, check_url, headers_for, provider_error, resolve
from .db import get_db, settings_get, settings_set
from .routes import must_admin, must_user, sniff
from .security import RateLimiter

router = APIRouter(prefix="/api")
ocr_limiter = RateLimiter(20, 60)
MAX_IMAGE = 8 * 1024 * 1024
MIME = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}
DEFAULT_PROMPT = ("Read the image and reply with only the text shown in it, exactly as written, in reading order. "
                  "No introduction, no explanation, no quotation marks or code fences around it, and do not describe the picture. "
                  "Join lines that are only wrapped inside a paragraph and keep paragraph breaks as blank lines. "
                  "Use Markdown only for structure that is clearly on the page: # headings, - bullet or 1. numbered lists, and tables. "
                  "If there is no readable text, reply with exactly NO_TEXT.")


def config(db) -> dict:
    """What the administrator decided: which model reads pictures, the instruction it gets, whether people may pick another, and the default way."""
    return {"model_id": settings_get(db, "ocr_model"), "prompt": settings_get(db, "ocr_prompt") or DEFAULT_PROMPT,
            "lock": settings_get(db, "ocr_lock") == "1", "default": settings_get(db, "ocr_default") if settings_get(db, "ocr_default") in ("local", "ai") else ""}


def pick(db, user, wanted: str | None) -> dict | None:
    """The administrator's model, unless they let people choose and this person asked for another one they may use."""
    cfg = config(db)
    by_id = {m["id"]: m for m in available(db, user)}
    if cfg["model_id"] in by_id and (cfg["lock"] or not wanted or wanted not in by_id):
        return by_id[cfg["model_id"]]
    return resolve(db, user, wanted)


def clean(text: str) -> str:
    t = (text or "").strip()
    m = re.fullmatch(r"```[a-zA-Z]*\n([\s\S]*?)\n```", t)   # some models wrap the answer in a code fence
    t = (m.group(1) if m else t).strip()
    return "" if t == "NO_TEXT" else t


async def run_model(s: dict, data: bytes, ext: str, prompt: str) -> str:
    """Send one picture to one model with the instruction and return the text."""
    cf = CF_NATIVE.match(s["base_url"].strip().rstrip("/"))
    base = await check_url(s["base_url"])
    url = f"data:{MIME[ext]};base64,{base64.b64encode(data).decode()}"
    dedicated = (urlparse(base).hostname == "api.mistral.ai") and "ocr" in s["model"].lower()   # Mistral's own OCR model has its own endpoint
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(READ_TIMEOUT, connect=CONNECT_TIMEOUT), follow_redirects=False) as c:
            if cf:   # Workers AI REST API: .../ai/run/<model>, the picture as an image_url part
                r = await c.post(f"{cf.group(1)}/ai/run/{s['model']}", headers=headers_for(s), json={
                    "max_tokens": 4096, "temperature": 0,
                    "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": url}}]}]})
            elif dedicated:
                r = await c.post(f"{base}/ocr", headers=headers_for(s), json={"model": s["model"], "document": {"type": "image_url", "image_url": url}})
            else:
                r = await c.post(f"{base}/chat/completions", headers=headers_for(s), json={
                    "model": s["model"], "temperature": 0, "max_tokens": 4096, "stream": False,
                    "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": url}}]}]})
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Could not reach the provider ({type(e).__name__})")
    if r.status_code >= 400:
        msg = provider_error(r)
        hint = " This model may not be able to see pictures: pick a vision model (for example gpt-4o, pixtral or a Llama vision model)." if r.status_code in (400, 404, 422) and not dedicated else ""
        raise HTTPException(502 if r.status_code != 429 else 429, msg + hint)
    try:
        j = r.json()
        if cf:
            res = j.get("result", j)
            if j.get("success") is False or not isinstance(res, dict):
                raise ValueError
            text = res.get("response") if "choices" not in res else res["choices"][0]["message"]["content"]
            text = text if isinstance(text, str) else json.dumps(text or "")
        elif dedicated:
            text = "\n\n".join(str(p.get("markdown", "")) for p in j.get("pages", []))
        else:
            c0 = j["choices"][0]["message"]["content"]
            text = c0 if isinstance(c0, str) else "".join(str(p.get("text", "")) for p in c0 if isinstance(p, dict))
    except Exception:
        raise HTTPException(502, "The provider's answer wasn't in the expected format")
    return clean(text)


async def read_upload(file: UploadFile) -> tuple[bytes, str]:
    data = await file.read(MAX_IMAGE + 1)
    if len(data) > MAX_IMAGE:
        raise HTTPException(413, "That picture is larger than 8 MB")
    ext = sniff(data)
    if not ext:
        raise HTTPException(415, "Only PNG, JPEG, GIF and WebP pictures can be read")
    return data, ext


@router.get("/ocr/config")
def public_config(user=Depends(must_user), db=Depends(get_db)):
    """What the Scan a page dialog needs to know about the administrator's choices."""
    cfg, av = config(db), available(db, user)
    chosen = next((m for m in av if m["id"] == cfg["model_id"]), None)
    return {"available": bool(av), "model": {"id": chosen["id"], "label": chosen["label"], "model": chosen["model"]} if chosen else None, "locked": bool(chosen) and cfg["lock"], "default": cfg["default"]}


@router.post("/ocr")
async def read_picture(file: UploadFile = File(...), model_id: str | None = Form(None), user=Depends(must_user), db=Depends(get_db)):
    if not ocr_limiter.allow(f"ocr:{user['id']}"):
        raise HTTPException(429, "Too many pages at once. Try again in a minute.")
    data, ext = await read_upload(file)
    s = pick(db, user, model_id)
    if not s or not s.get("model"):
        raise HTTPException(409, "No AI model is set up to read pictures. An administrator can choose one in the admin panel (Scan a page), or add a model in the assistant settings (it has to be one that can see pictures).")
    return {"text": await run_model(s, data, ext, config(db)["prompt"])}


# ───────────────────────── the administrator's side ─────────────────────────
@router.get("/admin/ocr")
def admin_get(admin=Depends(must_admin), db=Depends(get_db)):
    from .ai import system_models
    return {**config(db), "default_prompt": DEFAULT_PROMPT, "models": [{"id": m["id"], "label": m["label"], "model": m["model"], "host": urlparse(m["base_url"]).hostname or ""} for m in system_models(db)]}


class OcrAdminIn(BaseModel):
    model_id: str | None = Field(None, max_length=60)
    prompt: str | None = Field(None, max_length=4000)
    lock: bool | None = None
    default: str | None = Field(None, pattern="^(local|ai|)$")


@router.put("/admin/ocr")
def admin_put(b: OcrAdminIn, admin=Depends(must_admin), db=Depends(get_db)):
    from .ai import system_models
    if b.model_id is not None:
        if b.model_id and b.model_id not in {m["id"] for m in system_models(db)}:
            raise HTTPException(422, "Choose one of the models offered to everyone (add it in Assistant first)")
        settings_set(db, "ocr_model", b.model_id)
    if b.prompt is not None:
        p = b.prompt.strip()
        settings_set(db, "ocr_prompt", "" if p == DEFAULT_PROMPT else p)
    if b.lock is not None:
        settings_set(db, "ocr_lock", "1" if b.lock else "0")
    if b.default is not None:
        settings_set(db, "ocr_default", b.default)
    db.commit()
    return admin_get(admin, db)


@router.post("/admin/ocr/test")
async def admin_test(file: UploadFile = File(...), admin=Depends(must_admin), db=Depends(get_db)):
    """Try the saved choice on a picture of the administrator's own: shows exactly what people would get."""
    data, ext = await read_upload(file)
    s = pick(db, admin, None)
    if not s or not s.get("model"):
        raise HTTPException(409, "Choose a model first")
    import time
    t0 = time.time()
    return {"text": await run_model(s, data, ext, config(db)["prompt"]), "model": s["label"], "ms": round((time.time() - t0) * 1000)}
