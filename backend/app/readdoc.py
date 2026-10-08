"""Turns a stored file (its Yjs state) into plain, readable text for the assistant to cross-reference: Markdown-ish for documents and
wiki pages, rows of cells for spreadsheets, text per slide, the questions of a form, columns and cards of a board. Read only.
Spreadsheet formulas are shown as typed, because results are worked out in the browser and not stored."""
from pycrdt import Array, Doc, Map, XmlElement, XmlFragment, XmlText

MAX_CHARS = 60_000
ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def col_name(c: int) -> str:
    s = ""
    c += 1
    while c:
        c, r = divmod(c - 1, 26)
        s = ALPHA[r] + s
    return s


def _inline(node) -> str:
    out = []
    for seg, attrs in node.diff():
        if not isinstance(seg, str):
            continue
        a = attrs or {}
        link = a.get("link")
        href = link.get("href") if isinstance(link, dict) else None
        if a.get("code"):
            seg = f"`{seg}`"
        if a.get("bold") and seg.strip():
            seg = f"**{seg}**"
        if a.get("italic") and seg.strip():
            seg = f"*{seg}*"
        out.append(f"[{seg}]({href})" if href else seg)
    return "".join(out)


def _text_of(el) -> str:
    """The inline text directly inside a block, including small inline nodes (hard breaks, emoji)."""
    parts = []
    for ch in el.children:
        if isinstance(ch, XmlText):
            parts.append(_inline(ch))
        elif isinstance(ch, XmlElement):
            if ch.tag == "hardBreak":
                parts.append("\n")
            elif ch.tag in ("emoji", "mention"):
                parts.append(str(ch.attributes.get("char") or ch.attributes.get("emoji") or ch.attributes.get("label") or ""))
            else:
                parts.append(_text_of(ch))
    return "".join(parts)


def _block(el, depth=0) -> list[str]:
    tag, at = el.tag, dict(el.attributes)
    kids = [c for c in el.children if isinstance(c, XmlElement)]
    pad = "  " * depth
    if tag == "heading":
        return ["#" * max(1, min(6, int(at.get("level") or 1))) + " " + _text_of(el).strip(), ""]
    if tag == "paragraph":
        t = _text_of(el).strip()
        return [pad + t, ""] if t else []
    if tag in ("bulletList", "orderedList", "taskList"):
        out = []
        for n, li in enumerate([k for k in kids if k.tag in ("listItem", "taskItem")], 1):
            mark = f"{n}." if tag == "orderedList" else ("- [x]" if str(dict(li.attributes).get("checked")).lower() in ("true", "1") else "- [ ]") if tag == "taskList" else "-"
            inner = [b for k in li.children if isinstance(k, XmlElement) for b in _block(k, depth + 1)]
            first = next((i for i, b in enumerate(inner) if b.strip()), None)
            if first is None:
                continue
            inner[first] = f"{pad}{mark} {inner[first].strip()}"
            out += [b for b in inner if b != ""]
        return out + [""]
    if tag == "blockquote":
        return ["> " + b if b else "" for k in kids for b in _block(k)]
    if tag == "callout":
        title = at.get("title") or at.get("kind") or "Note"
        return [f"> **{title}**"] + ["> " + b for k in kids for b in _block(k) if b] + [""]
    if tag == "codeBlock":
        return ["```", _text_of(el), "```", ""]
    if tag == "horizontalRule":
        return ["---", ""]
    if tag == "image":
        return [f"[image: {at.get('alt') or at.get('title') or 'picture'}]", ""]
    if tag == "table":
        rows = []
        for tr in [k for k in kids if k.tag == "tableRow"]:
            rows.append([" ".join(b for k in cell.children if isinstance(k, XmlElement) for b in _block(k) if b).replace("|", "/") for cell in tr.children if isinstance(cell, XmlElement)])
        if not rows:
            return []
        width = max(len(r) for r in rows)
        rows = [r + [""] * (width - len(r)) for r in rows]
        return ["| " + " | ".join(rows[0]) + " |", "|" + " --- |" * width] + ["| " + " | ".join(r) + " |" for r in rows[1:]] + [""]
    if kids:   # an unknown wrapper: read what is inside it
        return [b for k in kids for b in _block(k, depth)]
    t = _text_of(el).strip()
    return [t, ""] if t else []


def fragment_md(frag) -> str:
    lines = []
    for ch in frag.children:
        if isinstance(ch, XmlElement):
            lines += _block(ch)
        elif isinstance(ch, XmlText):
            t = _inline(ch).strip()
            if t:
                lines += [t, ""]
    text = "\n".join(lines)
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    return text.strip()


def _sheet(d: Doc) -> str:
    out = []
    tabs = sorted((dict(t) for t in d.get("tabs", type=Map).values() if hasattr(t, "keys")), key=lambda t: t.get("order", 0))
    for t in tabs:
        tid = str(t.get("id", ""))
        rows: dict[int, dict[int, str]] = {}
        for k, cell in d.get("cells:" + tid, type=Map).items():
            v = cell.get("v") if hasattr(cell, "get") else None
            try:
                r, c = (int(x) for x in str(k).split(","))
            except ValueError:
                continue
            if v not in (None, ""):
                rows.setdefault(r, {})[c] = str(v)
        out.append(f"## Sheet: {t.get('name', 'Sheet')}")
        if not rows:
            out.append("(empty)")
        for r in sorted(rows):
            out.append(f"{r + 1}: " + " | ".join(f"{col_name(c)}={v}" for c, v in sorted(rows[r].items())))
        out.append("")
    return "\n".join(out).strip()


def _slides(d: Doc) -> str:
    out = []
    order, slides = d.get("order", type=Array), d.get("slides", type=Map)
    for n, sid in enumerate(order, 1):
        sl = slides.get(str(sid))
        if sl is None or not hasattr(sl, "get"):
            continue
        out.append(f"## Slide {n}")
        els = sl.get("els")
        for e in (els.values() if els is not None else []):
            if hasattr(e, "get") and isinstance(e.get("text"), str) and e.get("text").strip():
                out.append(e.get("text").strip())
        if isinstance(sl.get("notes"), str) and sl.get("notes").strip():
            out.append("Speaker notes: " + sl.get("notes").strip())
        out.append("")
    return "\n".join(out).strip()


def _form(d: Doc) -> str:
    items = d.get("items", type=Map)
    meta = d.get("meta", type=Map)
    out = []
    if isinstance(meta.get("description"), str) and meta.get("description"):
        out += [meta.get("description"), ""]
    for n, iid in enumerate(d.get("order", type=Array), 1):
        it = items.get(str(iid))
        if not isinstance(it, dict):
            continue
        line = f"{n}. [{it.get('type')}] {it.get('title') or ''}" + (" (required)" if it.get("required") else "")
        out.append(line)
        if it.get("help"):
            out.append(f"   {it['help']}")
        for o in it.get("options") or []:
            out.append(f"   - {o}")
    return "\n".join(out).strip()


def _board(d: Doc) -> str:
    cols, cards, fields = d.get("cols", type=Map), d.get("cards", type=Map), d.get("fields", type=Map)
    flist = [(str(fid), fields.get(str(fid))) for fid in d.get("fieldOrder", type=Array)]
    flist = [(i, f) for i, f in flist if isinstance(f, dict)]
    def show(f, v):
        if f.get("type") in ("single", "multi"):
            ids = v if isinstance(v, list) else [v]
            return ", ".join(o.get("label", "") for o in f.get("options") or [] if o.get("id") in ids)
        return "yes" if v is True else str(v)
    out = []
    for cid in d.get("colOrder", type=Array):
        col = cols.get(str(cid))
        if not isinstance(col, dict):
            continue
        mine = sorted((c for c in cards.values() if isinstance(c, dict) and c.get("col") == str(cid)), key=lambda c: c.get("rank", 0))
        out.append(f"## {col.get('name')} ({len(mine)})")
        for c in mine:
            vals = [f"{f.get('name')}: {show(f, (c.get('v') or {}).get(i))}" for i, f in flist if (c.get("v") or {}).get(i) not in (None, "", [])]
            out.append(f"- {c.get('title')}" + (f" ({'; '.join(vals)})" if vals else ""))
            if c.get("desc"):
                out.append(f"  {c['desc']}")
        out.append("")
    return "\n".join(out).strip()


def _wiki(d: Doc) -> str:
    tree = {str(k): dict(v) for k, v in d.get("tree", type=Map).items() if hasattr(v, "keys")}
    def kids(parent):
        return sorted((i for i, e in tree.items() if (e.get("parent") or None) == parent), key=lambda i: tree[i].get("pos", 0))
    out = []
    def walk(parent, depth):
        for i in kids(parent):
            e = tree[i]
            if e.get("t") == "folder":
                out.append(f"{'#' * min(6, depth + 1)} {e.get('title')} (folder)")
                walk(i, depth + 1)
            else:
                out += [f"{'#' * min(6, depth + 1)} {e.get('title')}", fragment_md(d.get("p:" + i, type=XmlFragment)), ""]
    walk(None, 1)
    return "\n".join(out).strip()


def render(blob: bytes | None, kind: str) -> tuple[str, bool]:
    """(text, was it cut short?)"""
    if not blob:
        return "", False
    d = Doc()
    d.apply_update(bytes(blob))
    try:
        text = {"sheet": _sheet, "slides": _slides, "form": _form, "board": _board, "wiki": _wiki}.get(kind, lambda x: fragment_md(x.get("default", type=XmlFragment)))(d)
    except Exception:
        text = ""
    if len(text) > MAX_CHARS:
        return text[:MAX_CHARS].rstrip() + "\n…", True
    return text, False
