"""Reading text from a photo of a page with the AI provider (the "AI provider" choice in Scan a page).

The other choice, reading it on the person's own device, never reaches the server at all. Here the picture is relayed to the model the person
picked (any OpenAI-compatible model that can see pictures, or Mistral's dedicated OCR model) and the text comes back. Nothing is stored."""
import base64
import re
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from .ai import CF_NATIVE, CONNECT_TIMEOUT, READ_TIMEOUT, check_url, headers_for, provider_error, resolve
from .db import get_db
from .routes import must_user, sniff
from .security import RateLimiter

router = APIRouter(prefix="/api")
ocr_limiter = RateLimiter(20, 60)
MAX_IMAGE = 8 * 1024 * 1024
MIME = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}
PROMPT = ("Transcribe all the text in this image exactly as written, in reading order. Reply with only the transcription, no commentary. "
          "Join lines that are just wrapped inside a paragraph, and keep paragraph breaks as blank lines. "
          "Use Markdown only for structure that is clearly on the page: # headings, - bullet or 1. numbered lists, and tables. "
          "Do not describe pictures. If there is no readable text, reply with exactly NO_TEXT.")


def clean(text: str) -> str:
    t = (text or "").strip()
    m = re.fullmatch(r"```[a-zA-Z]*\n([\s\S]*?)\n```", t)   # some models wrap the answer in a code fence
    t = (m.group(1) if m else t).strip()
    return "" if t == "NO_TEXT" else t


@router.post("/ocr")
async def read_picture(file: UploadFile = File(...), model_id: str | None = Form(None), user=Depends(must_user), db=Depends(get_db)):
    if not ocr_limiter.allow(f"ocr:{user['id']}"):
        raise HTTPException(429, "Too many pages at once. Try again in a minute.")
    data = await file.read(MAX_IMAGE + 1)
    if len(data) > MAX_IMAGE:
        raise HTTPException(413, "That picture is larger than 8 MB")
    ext = sniff(data)
    if not ext:
        raise HTTPException(415, "Only PNG, JPEG, GIF and WebP pictures can be read")
    s = resolve(db, user, model_id)
    if not s or not s.get("model"):
        raise HTTPException(409, "Add an AI model in the assistant settings first (it has to be one that can see pictures)")
    if CF_NATIVE.match(s["base_url"].strip().rstrip("/")):
        raise HTTPException(422, "This Cloudflare connection can't read pictures. Choose another model.")
    base = await check_url(s["base_url"])
    url = f"data:{MIME[ext]};base64,{base64.b64encode(data).decode()}"
    dedicated = (urlparse(base).hostname == "api.mistral.ai") and "ocr" in s["model"].lower()   # Mistral's own OCR model has its own endpoint
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(READ_TIMEOUT, connect=CONNECT_TIMEOUT), follow_redirects=False) as c:
            if dedicated:
                r = await c.post(f"{base}/ocr", headers=headers_for(s), json={"model": s["model"], "document": {"type": "image_url", "image_url": url}})
            else:
                r = await c.post(f"{base}/chat/completions", headers=headers_for(s), json={
                    "model": s["model"], "temperature": 0, "max_tokens": 4096, "stream": False,
                    "messages": [{"role": "user", "content": [{"type": "text", "text": PROMPT}, {"type": "image_url", "image_url": {"url": url}}]}]})
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Could not reach the provider ({type(e).__name__})")
    if r.status_code >= 400:
        msg = provider_error(r)
        hint = " This model may not be able to see pictures: pick a vision model (for example gpt-4o, pixtral or a Llama vision model)." if r.status_code in (400, 404, 422) and not dedicated else ""
        raise HTTPException(502 if r.status_code != 429 else 429, msg + hint)
    try:
        j = r.json()
        if dedicated:
            text = "\n\n".join(str(p.get("markdown", "")) for p in j.get("pages", []))
        else:
            c0 = j["choices"][0]["message"]["content"]
            text = c0 if isinstance(c0, str) else "".join(str(p.get("text", "")) for p in c0 if isinstance(p, dict))
    except Exception:
        raise HTTPException(502, "The provider's answer wasn't in the expected format")
    return {"text": clean(text)}
