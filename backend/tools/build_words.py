"""Builds the word lists the spell checker uses on top of its own small dictionary (run it with network access; the results are committed,
so a server never needs the internet):

  app/words/en_us.txt.gz     general English (SCOWL size 60, the dictionary behind LibreOffice and Firefox), every form expanded
  app/words/en_gb.txt.gz     the words British English has that the American list lacks
  app/words/tech.txt.gz      programming, software, tools, companies and file formats (cspell-dicts)

    python tools/build_words.py
"""
import gzip, io, json, re, sys, urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "app" / "words"
WOOORM = "https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/{}/index.{}"
CSPELL = "https://raw.githubusercontent.com/streetsidesoftware/cspell-dicts/main/dictionaries/{}/{}"
TECH = ("software-terms typescript node npm html css python git docker fullstack companies fonts filetypes google aws sql java golang rust php ruby markdown "
        "shell bash k8s mime-types cpp csharp swift kotlin cryptocurrencies gaming-terms public-licenses django vue svelte terraform data-science"
        "").split()
WORD = re.compile(r"^[a-z]{2,}$")
# real or near-real words that are far more often typos (or that a source includes by mistake): never accept them
EXCLUDE = set("dont wellcome definate wether maintainence".split())


def get(url: str) -> bytes | None:
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            return r.read()
    except Exception:
        return None


def expand(dic: str, aff: str) -> set[str]:
    """Hunspell .dic + .aff -> every word form (affix rules with their conditions, and prefix x suffix combinations)."""
    rules: dict[str, dict] = {}
    skip = set()
    for line in aff.splitlines():
        p = line.split()
        if not p:
            continue
        if p[0] in ("NOSUGGEST", "ONLYINCOMPOUND", "FORBIDDENWORD") and len(p) > 1:
            skip.add(p[1])
        elif p[0] in ("PFX", "SFX") and len(p) >= 4:
            if len(p) == 4 and p[2] in "YN":
                rules[p[1]] = {"kind": p[0], "cross": p[2] == "Y", "items": []}
            elif p[1] in rules and len(p) >= 5:
                strip = "" if p[2] == "0" else p[2]
                add = "" if p[3] == "0" else p[3].split("/")[0]
                cond = p[4]
                rx = re.compile((cond + "$") if rules[p[1]]["kind"] == "SFX" else ("^" + cond)) if cond != "." else None
                rules[p[1]]["items"].append((strip, add, rx))
    words: set[str] = set()
    for line in dic.splitlines()[1:]:
        if not line or line[0] in "#\t":
            continue
        word, _, flags = line.split()[0].partition("/")
        if any(f in skip for f in flags):
            continue
        forms = {word}
        pre, suf = [], []
        for f in flags:
            r = rules.get(f)
            if not r:
                continue
            for strip, add, rx in r["items"]:
                if rx and not rx.search(word):
                    continue
                if r["kind"] == "SFX" and word.endswith(strip):
                    new = word[: len(word) - len(strip)] + add if strip else word + add
                    suf.append((new, r["cross"]))
                elif r["kind"] == "PFX" and word.startswith(strip):
                    new = add + word[len(strip):]
                    pre.append((new, r["cross"]))
        forms |= {w for w, _ in suf} | {w for w, _ in pre}
        for pw, pc in pre:   # a prefixed suffixed form, only when both rules allow crossing
            if pc:
                forms |= {pw + sw[len(word):] for sw, sc in suf if sc and sw.startswith(word)}
        words |= forms
    return words


def clean(words) -> list[str]:
    return sorted({w.lower() for w in words if WORD.match(w.lower())} - EXCLUDE)


def save(name: str, words: list[str]) -> None:
    with gzip.open(OUT / name, "wt", encoding="utf-8", compresslevel=9) as f:
        f.write("\n".join(words) + "\n")
    print(f"{name}: {len(words):,} words, {(OUT / name).stat().st_size // 1024} KB")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    us = clean(expand(get(WOOORM.format("en", "dic")).decode(), get(WOOORM.format("en", "aff")).decode()))
    gb = clean(expand(get(WOOORM.format("en-GB", "dic")).decode(), get(WOOORM.format("en-GB", "aff")).decode()))
    save("en_us.txt.gz", us)
    us_set = set(us)
    gb_only = [w for w in gb if w not in us_set]
    save("en_gb.txt.gz", gb_only)
    gb_only_set = set(gb_only)
    tech: set[str] = set()
    for name in TECH:
        raw = get(CSPELL.format(name, "cspell-ext.json"))
        if not raw:
            continue
        try:
            cfg = json.loads(re.sub(r"^\s*//.*$", "", raw.decode(), flags=re.M))
        except ValueError:
            continue
        for d in cfg.get("dictionaryDefinitions", []):
            path = d.get("path", "").lstrip("./")
            if not path.endswith((".txt", ".txt.gz")) or "misspell" in path:
                continue
            base = path[:-3] if path.endswith(".gz") else path
            tried = [path, base, base.replace("dict/", "src/", 1), "src/" + base.rsplit("/", 1)[-1], base.rsplit("/", 1)[-1]]   # the repo keeps the sources, not the compiled .gz
            body = next((b for b in (get(CSPELL.format(name, p)) for p in dict.fromkeys(tried)) if b), None)
            if not body:
                continue
            text = gzip.decompress(body).decode() if body[:2] == b"\x1f\x8b" else body.decode()
            for line in text.splitlines():
                line = line.strip().lstrip("+*~")
                if line and line[0] not in "#!":
                    tech.add(line.split()[0].split("/")[0])
        print("  tech:", name, len(tech))
    save("tech.txt.gz", [w for w in clean(tech) if w not in us_set and w not in gb_only_set])   # British spellings (colour) stay out: American English must still flag them


if __name__ == "__main__":
    main()
