"""Lets the "Try it" panel in a wiki send a request from the server when the browser can't (most APIs don't allow cross-origin calls).
Only signed-in people can use it, only the public internet is reachable, and the size and time of every call are capped."""
import base64
import time
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .routes import assert_public, must_user
from .security import RateLimiter

router = APIRouter(prefix="/api/wiki")
limiter = RateLimiter(60, 60)
MAX_BODY = 2 * 1024 * 1024
DROP_REQ = {"host", "content-length", "connection", "transfer-encoding", "upgrade", "te", "proxy-authorization"}
DROP_RES = {"set-cookie", "set-cookie2", "connection", "transfer-encoding", "content-encoding", "content-length"}


class ProxyReq(BaseModel):
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] = "GET"
    url: str = Field(max_length=4000)
    headers: dict[str, str] = Field(default_factory=dict)
    body: str | None = Field(default=None, max_length=1_000_000)


@router.post("/proxy")
async def proxy(b: ProxyReq, user=Depends(must_user)):
    if not limiter.allow(f"wikiproxy:{user['id']}"):
        raise HTTPException(429, "Too many requests. Try again in a minute.")
    headers = {k: v for k, v in list(b.headers.items())[:40] if k.lower() not in DROP_REQ and "\n" not in k + v and "\r" not in k + v}
    headers.setdefault("User-Agent", "KokoDocs-TryIt/1.0")
    url, t0 = b.url.strip(), time.time()
    method, data = b.method, (b.body.encode() if b.body is not None and b.method not in ("GET", "HEAD") else None)
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=httpx.Timeout(20.0, connect=8.0)) as client:
            for _hop in range(4):   # redirects are followed by hand so each hop is checked
                await assert_public(url)
                async with client.stream(method, url, headers=headers, content=data) as r:
                    if r.is_redirect and r.headers.get("location"):
                        url = str(httpx.URL(url).join(r.headers["location"]))
                        if r.status_code in (301, 302, 303) and method not in ("GET", "HEAD"):
                            method, data = "GET", None
                        continue
                    raw = b""
                    async for chunk in r.aiter_bytes():
                        raw += chunk
                        if len(raw) > MAX_BODY:
                            raw = raw[:MAX_BODY]
                            break
                    ctype = r.headers.get("content-type", "")
                    textual = any(t in ctype for t in ("json", "text", "xml", "javascript", "html", "yaml", "x-www-form")) or not ctype
                    try:
                        body, binary = (raw.decode(r.charset_encoding or "utf-8", errors="replace"), False) if textual else (base64.b64encode(raw).decode(), True)
                    except LookupError:
                        body, binary = raw.decode("utf-8", errors="replace"), False
                    return {"status": r.status_code, "status_text": r.reason_phrase, "ms": int((time.time() - t0) * 1000), "size": len(raw), "binary": binary, "body": body,
                            "headers": {k: v for k, v in r.headers.items() if k.lower() not in DROP_RES}, "url": url}
        raise HTTPException(502, "Too many redirects")
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(504, "The server took too long to answer")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Couldn't reach that server ({type(e).__name__})")
