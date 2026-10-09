# KokoDocs text reader (self-hosted)

A small, separate service that reads the text in a picture for **Scan a page**, using Microsoft's Florence-2-base
(230 million parameters, MIT licence; the weights are about 0.45 GB and download on first start).
It only reads text. It cannot chat or answer questions.

```bash
cd ocr-server
python -m venv venv && . venv/bin/activate
pip install -r requirements.txt
python server.py            # http://127.0.0.1:9100/v1
```

In KokoDocs: **Admin → Assistant**, add a model for everyone with URL `http://127.0.0.1:9100/v1`, model `florence-2-base` and any
API key; then **Admin → Scan a page**, choose it. The KokoDocs server must be allowed to call local addresses
(`KOKO_AI_ALLOW_PRIVATE=1`) unless the reader runs on another machine with a public address.
Set `KOKO_OCR_KEY` on the reader to require that API key; `KOKO_OCR_HOST=0.0.0.0` to listen on the network (put it behind your
own firewall, it is meant to be called only by the KokoDocs server).

## How it reads

The picture is sent as a `data:` URL (web addresses are never fetched). A first look finds the lines of text; the area around
them is cropped (the desk is cut away) and read again, bigger. Tall pages are cut into strips on the emptiest row.
Lines are joined into paragraphs by their spacing. One picture is read at a time.

## What it costs (measured on an Apple M-series laptop with 16 GB)

| | Memory of the process | A page of text |
|---|---|---|
| Apple GPU, 16-bit | 1.2 GB (model about 0.5 GB) | 1–2 s, a dense page about 7 s |
| CPU, bfloat16 | 1.3 GB | about 13 s, a dense page about 26 s |

The process is larger than the model because of the PyTorch runtime. A CPU-only server with an older chip may be slower still.

## How good it is

On synthetic phone-style photos (a page on a desk, tilted, shaded, blurred) and handwriting-style fonts it made 0% to 0.2%
character errors, and about 0.5% on a dense page of different paragraphs. It struggles when many paragraphs are near-identical
(it starts to "autocomplete"), and it is untested on real handwriting. It returns plain text, with no headings, lists or tables.
