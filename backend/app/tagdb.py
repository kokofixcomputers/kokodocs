"""Tags: personal labels each person puts on files and folders (like stars, nobody else sees them)."""
import re

MAX_TAGS = 12
MAX_LEN = 30
TABLES = {"doc": ("doc_tags", "doc_id"), "folder": ("folder_tags", "folder_id")}


def clean(raw: list) -> list[str]:
    """Trimmed, single-spaced, no commas, at most 30 characters, no duplicates (ignoring case), at most 12."""
    out: list[str] = []
    seen: set[str] = set()
    for t in raw:
        if not isinstance(t, str):
            continue
        t = re.sub(r"\s+", " ", t.replace(",", " ")).strip()[:MAX_LEN].strip()
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out[:MAX_TAGS]


def tag_map(db, kind: str, user_id: str) -> dict[str, list[str]]:
    """item id -> that person's tags, in alphabetical order."""
    table, col = TABLES[kind]
    out: dict[str, list[str]] = {}
    for r in db.execute(f"SELECT {col} AS id, tag FROM {table} WHERE user_id = ? ORDER BY tag COLLATE NOCASE", (user_id,)):
        out.setdefault(r["id"], []).append(r["tag"])
    return out
