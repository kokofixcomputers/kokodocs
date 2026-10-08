"""Spelling & grammar. Local rule engine by default; LanguageTool if KOKO_LANGUAGETOOL_URL is set
(e.g. a self-hosted server, so document text never leaves your infrastructure unless you choose)."""
import asyncio
import gzip
import json
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path

from spellchecker import SpellChecker

from . import dialects

LT_URL = os.environ.get("KOKO_LANGUAGETOOL_URL")
_spell = SpellChecker()
WORDS = Path(__file__).parent / "words"


def _words(name: str) -> list[str]:
    try:
        opener = gzip.open if name.endswith(".gz") else open
        with opener(WORDS / name, "rt", encoding="utf-8") as f:
            return f.read().split()
    except OSError:
        return []


# The built-in dictionary is small (everyday speech), so it also learns a full English word list (SCOWL, the one behind LibreOffice and
# Firefox) and the vocabulary of software (cspell-dicts), plus a few words of our own and, if the admin has one, KOKO_EXTRA_WORDS (a text
# file, one word per line). They come from tools/build_words.py and are shipped with the app, so no internet is needed. Words that are only
# British are kept apart: they are accepted when proofreading in a British-family English, not in American.
_BASE = set(_spell.word_frequency.dictionary)
_spell.word_frequency.load_words(_words("en_us.txt.gz") + _words("tech.txt.gz") + _words("extra.txt"))
if os.environ.get("KOKO_EXTRA_WORDS"):
    try:
        _spell.word_frequency.load_words(Path(os.environ["KOKO_EXTRA_WORDS"]).read_text(encoding="utf-8").lower().split())
    except OSError:
        pass
GB_WORDS = frozenset(_words("en_gb.txt.gz"))
for _w in GB_WORDS - _BASE:   # whatever list a British spelling sneaked in from, American English must not accept it
    _spell.word_frequency.dictionary.pop(_w, None)
WORD = re.compile(r"[A-Za-z][A-Za-z'’]*")
OBJ = "￼"

# Short forms that are right as they are: units, measures, times, titles and everyday abbreviations
SHORT_FORMS = set("""
mm cm m km in ft yd mi nmi sqft sqm sqkm sqmi cu cc ml l ltr dl cl kl mg g kg t lb lbs oz st tsp tbsp qt pt gal
mph kph kmh kmph kn rpm psi bar pa kpa mpa atm hz khz mhz ghz thz w kw mw gw wh kwh mwh v kv mv ma mah ohm db
b kb mb gb tb pb kbps mbps gbps bps px pt em rem vh vw dpi ppi fps ms ns us sec secs min mins hr hrs hrly yr yrs mo mos wk wks
am pm
mon tue tues wed thu thur thurs fri sat sun jan feb mar apr jun jul aug sep sept oct nov dec
etc approx esp incl excl misc info avg dept depts govt mgmt tel ext temp vs ie eg cf al fig figs vol vols ed eds abbr no nos ave blvd mt
jr sr dr mr mrs ms mx prof inc ltd co corp assn assoc bros est
""".split())
# attached straight to a number (5km, 10am, 2nd, 4x, 3d): the number says what it is
AFTER_DIGIT = SHORT_FORMS | {"st", "nd", "rd", "th", "x", "k", "m", "b", "d", "s", "h", "p", "mo", "yo"}


def _issue(block, start, end, kind, message, suggestions):
    return {
        "block": block,
        "offset": start,
        "length": end - start,
        "kind": kind,
        "message": message,
        "suggestions": suggestions[:5],
    }



# ───────────── confusable words (context rules, no ML) ─────────────
APOS = "['\u2019]"


def _case_like(orig: str, new: str) -> str:
    if orig.isupper() and len(orig) > 1:
        return new.upper()
    return new[0].upper() + new[1:] if orig[:1].isupper() else new


def _alt(words: str) -> str:
    return "(?:" + "|".join(words.split()) + ")"


_ING = "going doing coming being making trying saying getting taking looking working having doing using leaving staying playing running waiting thinking talking starting planning building"
_POSSESSED = ("house home car family friends friend parents kids children own work job team name names mother father dog cat room office company money books book phone computer "
              "idea fault turn way life lives eyes hands hand head heads school teacher boss manager email account order plan plans party shoes bag bags opinion opinions best first "
              "favorite favourite new old last next whole entire")
_IS_FORMS = "is are was were isn.t aren.t wasn.t weren.t will would has have had must should could seems might used"
_THEIR_SUGG = "there they're"

# (compiled regex with a (?P<w>...) group on the wrong word, message, suggestions, kind)
HOMOPHONES: list[tuple[re.Pattern, str, list[str]]] = []


def _h(pattern: str, msg: str, sugg: list[str]):
    HOMOPHONES.append((re.compile(pattern, re.I), msg, sugg))


# their / there / they're
_h(rf"\b(?P<w>their)\s+{_alt(_IS_FORMS)}\b", "“Their” shows possession. Here you probably mean “there”.", ["there"])
_h(rf"\b(?P<w>their)\s+(?=(?:not|never)\b)", "“Their” shows possession. Here you probably mean “they’re” (they are).", ["they\u2019re"])
_h(rf"\b(?P<w>their)\s+{_alt(_ING)}\b", "“Their” shows possession. Here you probably mean “they’re” (they are).", ["they\u2019re"])
_h(rf"\b(?P<w>there)\s+(?={_alt(_POSSESSED)}\b)", "“There” points to a place. To show possession, use “their”.", ["their"])
_h(rf"\b(?P<w>there)\s+(?={_alt(_ING)}\b)", "“There” points to a place. Here you probably mean “they’re” (they are).", ["they\u2019re"])
_h(rf"\b(?P<w>they{APOS}re)\s+(?={_alt(_POSSESSED)}\b)(?!\s*(?:is|are|was|were)\b)", "“They’re” means “they are”. To show possession, use “their”.", ["their"])
_h(rf"\b(?P<w>they{APOS}re)\s+(?={_alt('is are was were')}\b)", "“They’re” already means “they are”. Did you mean “there”?", ["there"])

# its / it's
_h(rf"\b(?P<w>its)\s+(?={_alt('a an the is was been going not time just so very really all only too still always never also about like quite getting ok okay late early cold hot warm raining snowing true fine obvious impossible')}\b)",
   "“Its” shows possession. Here you probably mean “it’s” (it is / it has).", ["it\u2019s"])
_h(rf"\b(?P<w>it{APOS}s)\s+(?={_alt('own way name size color colour shape purpose value place head tail owner use impact owners'.replace('impact',''))}\b)",
   "“It’s” means “it is”. To show possession, use “its”.", ["its"])

# affect / effect
_NOUN_LEAD = "the an a no any this that some side little big major huge negative positive lasting significant great real profound direct"
_h(rf"\b{_alt(_NOUN_LEAD)}\s+(?P<w>affects?)\b", "“Affect” is usually a verb. As a noun, use “effect”.", ["effect"])
# possessives: "her affect" is a real (psychology) noun, so only flag the very common "their affect on …" slip
_h(rf"\b{_alt('its their his her')}\s+(?P<w>affects?)\s+(?=(?:on|upon)\b)", "“Affect” is usually a verb. As a noun, use “effect”.", ["effect"])
_h(rf"\b{_alt('will would can could may might won.t wouldn.t can.t couldn.t doesn.t don.t didn.t to not shall should must')}\s+(?P<w>effect(?:s|ed|ing)?)\s+(?={_alt('the a an my your our their his her its me you us them him everyone everything how what whether people many all this these those')}\b)",
   "“Effect” is usually a noun. As a verb meaning “to influence”, use “affect”.", ["affect"])

# your / you're
_h(rf"\b(?P<w>your)\s+{_alt('a an the going welcome not being doing so very really right wrong just too always never still also gonna supposed allowed able ready late early sure correct done here there already all only getting making coming having trying looking working talking saying')}\b",
   "“Your” shows possession. Here you probably mean “you’re” (you are).", ["you\u2019re"])
_h(rf"\b(?P<w>you{APOS}re)\s+(?={_alt('own name house car phone email account order book mom dad mother father friend friends family job team company work life money'.replace('mom dad ','mom dad '))}\b)",
   "“You’re” means “you are”. To show possession, use “your”.", ["your"])


def homophone_issues(block_id: int, text: str) -> list[dict]:
    out = []
    for rx, msg, sugg in HOMOPHONES:
        for m in rx.finditer(text):
            a, b = m.span("w")
            orig = text[a:b]
            fixed = [_case_like(orig, x) for x in sugg]
            # keep the user's apostrophe style
            if "\u2019" in orig:
                fixed = [f.replace("'", "\u2019") for f in fixed]
            out.append(_issue(block_id, a, b, "grammar", msg, fixed))
    return out


# ───────────── punctuation ─────────────
CONTRACTIONS = {
    "dont": "don't", "cant": "can't", "wont": "won't", "isnt": "isn't", "arent": "aren't", "wasnt": "wasn't", "werent": "weren't", "doesnt": "doesn't",
    "didnt": "didn't", "couldnt": "couldn't", "shouldnt": "shouldn't", "wouldnt": "wouldn't", "hasnt": "hasn't", "havent": "haven't", "hadnt": "hadn't",
    "im": "I'm", "ive": "I've", "youre": "you're", "theyre": "they're", "thats": "that's", "whats": "what's", "theres": "there's", "youve": "you've", "weve": "we've",
    "theyve": "they've", "youll": "you'll", "theyll": "they'll", "hes": "he's", "shes": "she's",
}
_CONTRACTION_RE = re.compile(r"\b(" + "|".join(CONTRACTIONS) + r")\b", re.I)


def punctuation_issues(block_id: int, text: str) -> list[dict]:
    out = []
    # missing apostrophes
    for m in _CONTRACTION_RE.finditer(text):
        w = m.group(1)
        out.append(_issue(block_id, m.start(1), m.end(1), "grammar", f"Missing apostrophe: “{CONTRACTIONS[w.lower()].replace(chr(39), chr(8217))}”", [_case_like(w, CONTRACTIONS[w.lower()]) if w.lower() != "im" else "I'm"]))
    # space before , . ; : ! ?
    for m in re.finditer(r"(?<=[A-Za-z0-9\u201d\")\]])( +)(?=[,.;:!?](?:\s|$|[\u201d\"']))", text):
        out.append(_issue(block_id, m.start(1), m.end(1), "style", "Remove the space before the punctuation mark", [""]))
    # missing space after punctuation
    for m in re.finditer(r"(?<=[A-Za-z]{2})([,;!?])(?=[A-Za-z])", text):
        out.append(_issue(block_id, m.start(1), m.end(1), "grammar", "Add a space after the punctuation mark", [m.group(1) + " "]))
    for m in re.finditer(r"(?<=[A-Za-z]{2})(:)(?=[A-Za-z])(?!//)", text):
        if text[max(0, m.start() - 5):m.start()].lower().endswith(("http", "https", "ftp", "mailto", "file")) or text[m.end():m.end() + 1] == ":":
            continue
        out.append(_issue(block_id, m.start(1), m.end(1), "grammar", "Add a space after the colon", [": "]))
    for m in re.finditer(r"(?<=[a-z]{3})(\.)(?=[A-Z][a-z])", text):
        out.append(_issue(block_id, m.start(1), m.end(1), "grammar", "Add a space after the period", [". "]))
    # doubled marks
    for m in re.finditer(r",,+|;;+", text):
        out.append(_issue(block_id, m.start(), m.end(), "style", "Repeated punctuation", [m.group()[0]]))
    for m in re.finditer(r"(?<![.\u2026])\.\.(?![.\u2026])", text):
        out.append(_issue(block_id, m.start(), m.end(), "style", "Use one period, or three for an ellipsis", [".", "..."]))
    # spaces just inside brackets
    for m in re.finditer(r"(?<=\()( +)(?=\S)|(?<=\S)( +)(?=\))", text):
        g = 1 if m.group(1) else 2
        out.append(_issue(block_id, m.start(g), m.end(g), "style", "Remove the space inside the parentheses", [""]))
    # unbalanced brackets
    pairs = {")": "(", "]": "[", "}": "{"}
    stack: list[tuple[str, int]] = []
    for i, ch in enumerate(text):
        if ch in "([{":
            stack.append((ch, i))
        elif ch in pairs:
            # list markers such as "1)" or "a)" at the start of a line are not brackets
            if ch == ")" and re.fullmatch(r"\s*[A-Za-z0-9]{1,2}", text[:i]) and not stack:
                continue
            if ch == ")" and text[max(0, i - 1):i] in (":", ";") and (i + 1 >= len(text) or text[i + 1] in " .,!?"):
                continue  # :) ;) smileys
            if stack and stack[-1][0] == pairs[ch]:
                stack.pop()
            else:
                out.append(_issue(block_id, i, i + 1, "grammar", f"Unmatched “{ch}”", []))
    for ch, i in stack:
        out.append(_issue(block_id, i, i + 1, "grammar", f"Unclosed “{ch}”", []))
    return out


def local_check(block_id: int, text: str, lang: str = "en-US") -> list[dict]:
    out = []
    dia = dialects.dialect(lang)
    # misspellings
    for m in WORD.finditer(text):
        w = m.group().replace("’", "'")
        if len(w) < 2 or w.isupper() or "'" in w or w.lower() in CONTRACTIONS or w.lower() in SHORT_FORMS:
            continue
        if m.start() > 0 and text[m.start() - 1].isdigit() and w.lower() in AFTER_DIGIT:
            continue
        if w[0].isupper() and m.start() > 0 and text[max(0, m.start() - 2)] not in ".!?\n ":
            continue
        lw0 = w.lower()
        if dia == "gb" and lw0 in _spell and (alt := dialects.american_only(lw0)):
            out.append(_issue(block_id, m.start(), m.end(), "spelling", f"American spelling. In British English it is “{alt}”.", [_case_like(w, alt)]))
            continue
        if dia != "us" and lw0 in _spell.unknown([lw0]) and (lw0 in GB_WORDS or dialects.british_ok(lw0, lambda x: x in _spell)):
            continue   # a valid British spelling, such as colour or organise
        if w.lower() in _spell.unknown([w.lower()]):
            cands = _spell.candidates(w.lower()) or set()
            sugg = sorted(cands, key=lambda c: (-_spell.word_usage_frequency(c), c))
            lw = w.lower()
            splits = [f"{lw[:i]} {lw[i:]}" for i in range(1, len(lw))
                      if lw[:i] in _spell and lw[i:] in _spell and (i > 1 or lw[:i] in ("a", "i")) and len(lw[i:]) > 1]
            splits.sort(key=lambda x: -(_spell.word_usage_frequency(x.split()[0]) * _spell.word_usage_frequency(x.split()[1])))
            sugg = splits[:2] + sugg
            us = dialects.to_american(lw, lambda x: x in _spell) if dia == "us" else None
            if us:
                sugg = [us] + [x for x in sugg if x != us]
            if w[0].isupper():
                sugg = [s.capitalize() for s in sugg]
            out.append(_issue(block_id, m.start(), m.end(), "spelling", f"British spelling: “{w}”. Proofreading is set to American English." if us else f"Possible misspelling: “{w}”", sugg))
    # repeated words
    for m in re.finditer(r"\b([A-Za-z']+)(\s+)\1\b", text, re.I):
        out.append(_issue(block_id, m.start(), m.end(), "grammar", "Repeated word", [m.group(1)]))
    # a / an
    for m in re.finditer(r"\b(a|an)\s+([A-Za-z]+)", text, re.I):
        art, nxt = m.group(1), m.group(2).lower()
        vowel = nxt[0] in "aeiou" and not nxt.startswith(("uni", "use", "eu", "one", "ubi"))
        vowel = vowel or nxt.startswith(("hour", "honest", "heir"))
        want = "an" if vowel else "a"
        if art.lower() != want:
            fixed = want.capitalize() if art[0].isupper() else want
            out.append(_issue(block_id, m.start(1), m.end(1), "grammar", f"Use “{fixed}” before “{m.group(2)}”", [fixed]))
    # double spaces
    for m in re.finditer(r"(?<=\S) {2,}(?=\S)", text):
        out.append(_issue(block_id, m.start(), m.end(), "style", "Extra spaces", [" "]))
    # lowercase i
    for m in re.finditer(r"(?<![A-Za-z'’])i(?![A-Za-z'’])(?=\s|[.,!?]|$)", text):
        out.append(_issue(block_id, m.start(), m.end(), "grammar", "Capitalize “I”", ["I"]))
    # sentence capitalisation
    for m in re.finditer(r"(?:^|(?<!\.\.)[.!?]\s+)([a-z])[a-z]*", text):
        s = m.start(1)
        word = re.match(r"[a-z]+", text[s:]).group()
        if word in {"e", "i"} or text[s : s + 4].startswith(("http", "www.")):
            continue
        out.append(_issue(block_id, s, s + 1, "grammar", "Start sentences with a capital letter", [text[s].upper()]))
    out += homophone_issues(block_id, text)
    out += punctuation_issues(block_id, text)
    # dedupe overlapping (keep first)
    out.sort(key=lambda i: (i["offset"], -i["length"]))
    res, last = [], -1
    for i in out:
        if i["offset"] >= last:
            res.append(i)
            last = i["offset"] + i["length"]
    return res


def _lt_request(text: str, lang: str) -> list[dict]:
    data = urllib.parse.urlencode({"text": text, "language": lang}).encode()
    req = urllib.request.Request(LT_URL.rstrip("/") + "/v2/check", data=data)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)["matches"]


def _lt_check(block_id: int, text: str, lang: str) -> list[dict]:
    out = []
    for m in _lt_request(text, lang):
        kind = "spelling" if m["rule"]["issueType"] == "misspelling" else "grammar"
        if m["rule"]["issueType"] in ("style", "typographical"):
            kind = "style"
        out.append(
            {
                "block": block_id,
                "offset": m["offset"],
                "length": m["length"],
                "kind": kind,
                "message": m["message"],
                "suggestions": [r["value"] for r in m["replacements"][:5]],
            }
        )
    return out


async def check_blocks(blocks: list[dict], lang: str) -> list[dict]:
    def work():
        issues = []
        for b in blocks:
            text = b["text"].replace(OBJ, "_")  # inline objects (images, emoji) take one character and break up word repeats
            if not text.strip():
                continue
            if LT_URL:
                try:
                    issues += _lt_check(b["id"], text, lang)
                    continue
                except Exception:
                    pass
            issues += local_check(b["id"], text, lang)
        return issues

    return await asyncio.to_thread(work)
