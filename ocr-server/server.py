"""A tiny self-hosted text reader for KokoDocs "Scan a page": Florence-2-base (230M parameters, MIT licence) behind the
OpenAI chat API, so the admin panel can use it like any other model. It only reads text; it cannot answer questions.

    pip install -r requirements.txt
    python server.py                      # http://127.0.0.1:9100/v1

Then in KokoDocs: Admin -> Assistant -> add a model for everyone with URL http://127.0.0.1:9100/v1 and model name
"florence-2-base" (any API key if you set none), and pick it in Admin -> Scan a page.
(The KokoDocs server must be allowed to call local addresses: KOKO_AI_ALLOW_PRIVATE=1.)

Settings (environment): KOKO_OCR_MODEL (Hugging Face id or folder, default florence-community/Florence-2-base),
KOKO_OCR_HOST (127.0.0.1), KOKO_OCR_PORT (9100), KOKO_OCR_KEY (if set, requests must send it as the API key),
KOKO_OCR_DEVICE (cuda, mps or cpu; default: the best one found), KOKO_OCR_DTYPE (float16, bfloat16 or float32;
default float16 on a GPU and bfloat16 on a CPU, which halves the memory use).
"""
import asyncio, base64, binascii, io, os, re, secrets, statistics

import torch
import uvicorn
from fastapi import FastAPI, Header, HTTPException
from PIL import Image
from transformers import AutoProcessor, Florence2ForConditionalGeneration

MODEL_ID = os.environ.get("KOKO_OCR_MODEL", "florence-community/Florence-2-base")
NAME = "florence-2-base"
KEY = os.environ.get("KOKO_OCR_KEY", "")
MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
MAX_STRIPS = 8

device = os.environ.get("KOKO_OCR_DEVICE") or ("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
dtype = {"float16": torch.float16, "bfloat16": torch.bfloat16, "float32": torch.float32}[os.environ.get("KOKO_OCR_DTYPE") or ("float16" if device in ("cuda", "mps") else "bfloat16")]
processor = AutoProcessor.from_pretrained(MODEL_ID)
model = Florence2ForConditionalGeneration.from_pretrained(MODEL_ID, dtype=dtype).to(device).eval()
lock = asyncio.Lock()   # one picture at a time keeps the memory use flat
app = FastAPI(title="KokoDocs text reader", docs_url=None, redoc_url=None)


def strips(img: Image.Image) -> list[Image.Image]:
    """The model looks at a 768 px square, so a tall page is cut into roughly square strips, each cut on the emptiest row nearby."""
    w, h = img.size
    if h <= w * 1.15:
        return [img]
    gray = img.convert("L").resize((min(w, 400), max(1, round(h * min(w, 400) / w))))
    gw, gh = gray.size
    px = gray.load()
    ink = [sum(abs(px[x, y] - px[min(gw - 1, x + 1), y]) for x in range(gw)) for y in range(gh)]   # edge energy per row
    scale = h / gh
    target, cuts, y0 = w, [], 0
    while h - y0 > target * 1.15 and len(cuts) < MAX_STRIPS - 1:
        lo, hi = int((y0 + target * 0.7) / scale), int((y0 + target * 1.1) / scale)
        hi = min(hi, gh - 1)
        cut = min(range(lo, hi + 1), key=lambda i: ink[i]) if hi > lo else hi
        y0 = round(cut * scale)
        cuts.append(y0)
    edges = [0, *cuts, h]
    return [img.crop((0, a, w, b)) for a, b in zip(edges, edges[1:]) if b - a > 8]


def generate(images: list[Image.Image], task: str) -> list[str]:
    inp = processor(text=[task] * len(images), images=images, return_tensors="pt").to(device, dtype)
    with torch.no_grad():
        out = model.generate(input_ids=inp["input_ids"], pixel_values=inp["pixel_values"], max_new_tokens=1024, num_beams=1, do_sample=False)
    return processor.batch_decode(out, skip_special_tokens=False)


def read_strip(img: Image.Image) -> tuple[list[tuple[float, float, str]], tuple[float, float, float, float] | None]:
    """The lines the model found as (top, bottom, text), and the box that contains all of them."""
    raw = generate([img], "<OCR_WITH_REGION>")[0]
    res = processor.post_process_generation(raw, task="<OCR_WITH_REGION>", image_size=img.size)["<OCR_WITH_REGION>"]
    lines, box = [], None
    for q, text in zip(res["quad_boxes"], res["labels"]):
        text = re.sub(r"</?s>|<[^>]+>", "", text).strip()
        if text:
            xs, ys = q[0::2], q[1::2]
            lines.append((min(ys), max(ys), text))
            b = (min(xs), min(ys), max(xs), max(ys))
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return lines, box


def to_text(lines: list[tuple[float, float, str]]) -> str:
    """Lines to paragraphs: a line that starts clearly further down than the usual line spacing begins a new paragraph; wrapped lines are joined."""
    lines.sort(key=lambda l: l[1])
    if not lines:
        return ""
    base = [b for _, b, _ in lines]   # line bottoms: a short last line's box has a different height, so centres are unreliable
    pitch = [y2 - y1 for y1, y2 in zip(base, base[1:])]
    usual = statistics.median(pitch) if pitch else 0
    paras, cur = [], [lines[0][2]]
    for gap, (_, _, text) in zip(pitch, lines[1:]):
        if usual and gap > usual * 1.4:
            paras.append(cur); cur = []
        cur.append(text)
    paras.append(cur)
    out = []
    for p in paras:
        s = ""
        for t in p:
            s = s[:-1] + t if s.endswith("-") and t[:1].islower() else (s + " " + t if s else t)
        out.append(s)
    return "\n\n".join(out)


def read_all(img: Image.Image) -> str:
    return "\n\n".join(p for p in (to_text(read_strip(strip)[0]) for strip in strips(img)) if p)


def recognise(data: bytes) -> str:
    img = Image.open(io.BytesIO(data))
    img.load()
    img = img.convert("RGB")
    w, h = img.size
    if w * h > 600 * 600:
        # a first look finds where the text is; the rest (a desk, a table) is cut away and the text read again, bigger
        _, box = read_strip(strips(img)[0] if h <= w * 1.15 else img.resize((768, 768)))
        if box:
            sx, sy = (w / 768, h / 768) if h > w * 1.15 else (1, 1)
            x0, y0, x1, y1 = box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy
            mx, my = (x1 - x0) * 0.04 + 12, (y1 - y0) * 0.04 + 12
            x0, y0, x1, y1 = max(0, x0 - mx), max(0, y0 - my), min(w, x1 + mx), min(h, y1 + my)
            if (x1 - x0) * (y1 - y0) < w * h * 0.75:
                img = img.crop((int(x0), int(y0), int(x1), int(y1)))
    return read_all(img)


def find_picture(messages) -> bytes:
    for m in reversed(messages or []):
        c = m.get("content") if isinstance(m, dict) else None
        for part in c if isinstance(c, list) else []:
            if isinstance(part, dict) and part.get("type") == "image_url":
                url = (part.get("image_url") or {}).get("url", "") if isinstance(part.get("image_url"), dict) else str(part.get("image_url"))
                mt = re.match(r"^data:image/[a-z+.-]+;base64,(.+)$", url, re.S)
                if not mt:
                    raise HTTPException(400, "Send the picture as a data: URL (base64). Web addresses are not fetched.")
                if len(mt.group(1)) > MAX_BYTES * 4 // 3 + 16:
                    raise HTTPException(413, "That picture is too large")
                try:
                    return base64.b64decode(mt.group(1), validate=False)
                except (binascii.Error, ValueError):
                    raise HTTPException(400, "The picture could not be decoded")
    raise HTTPException(400, "This reader needs a picture (an image_url part) in the message")


def check(auth: str | None):
    if KEY and not secrets.compare_digest((auth or "").removeprefix("Bearer ").strip(), KEY):
        raise HTTPException(401, "Wrong API key")


@app.get("/v1/models")
def models(authorization: str | None = Header(None)):
    check(authorization)
    return {"object": "list", "data": [{"id": NAME, "object": "model", "owned_by": "local"}]}


@app.post("/v1/chat/completions")
async def chat(body: dict, authorization: str | None = Header(None)):
    check(authorization)
    data = find_picture(body.get("messages"))
    async with lock:
        try:
            text = await asyncio.to_thread(recognise, data)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(422, f"That picture could not be read ({type(e).__name__})")
    return {"id": "chatcmpl-" + secrets.token_hex(8), "object": "chat.completion", "model": NAME,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text or "NO_TEXT"}, "finish_reason": "stop"}]}


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID, "device": device}


if __name__ == "__main__":
    uvicorn.run(app, host=os.environ.get("KOKO_OCR_HOST", "127.0.0.1"), port=int(os.environ.get("KOKO_OCR_PORT", "9100")), log_level="warning")
