"""English spelling variants for the built-in proofreader. The dictionary is American, so for British-family English
(UK, Australia, New Zealand, South Africa, Ireland, India) we also accept the British spellings, and flag American-only ones;
Canadian English accepts both (it mixes them), and American English stays as it was."""
import re

GB_FAMILY = {"en-gb", "en-au", "en-nz", "en-za", "en-ie", "en-in"}
ALL = {"en-us", "en-ca"} | GB_FAMILY

LANGUAGES = [
    ("en-US", "English (US)"), ("en-GB", "English (UK)"), ("en-CA", "English (Canada)"), ("en-AU", "English (Australia)"),
    ("en-NZ", "English (New Zealand)"), ("en-ZA", "English (South Africa)"), ("en-IE", "English (Ireland)"), ("en-IN", "English (India)"),
]


def dialect(lang: str | None) -> str:
    """'us' (strict American), 'gb' (British family) or 'ca' (accepts both)."""
    l = (lang or "en-US").lower().replace("_", "-")
    if l in GB_FAMILY or l == "en-gb":
        return "gb"
    if l == "en-ca":
        return "ca"
    return "us"


# ── American -> British pairs. Every pair is also expanded with the usual endings (-s -ed -ing -ful ...). ──
_OR = ("color favor honor humor labor neighbor behavior flavor harbor rumor vapor savior odor parlor rigor vigor armor candor clamor endeavor glamor splendor tumor valor "
       "fervor demeanor ardor arbor rancor vigor misbehavior").split()
_ENDINGS = ["", "s", "ed", "ing", "ful", "fully", "less", "able", "ably", "ite", "ites", "ist", "ists", "y", "er", "ers", "ize", "ized", "izing", "ation", "ations", "hood", "ly"]
PAIRS: dict[str, str] = {}   # american -> british


def _inflect(stem: str, suf: str) -> str:
    if stem.endswith("e") and suf in ("ed", "er", "ers"):
        return stem + suf[1:]
    if stem.endswith("e") and suf in ("ing", "able", "ably", "ize", "ized", "izing", "ation", "ations", "ist", "ists", "y", "ite", "ites"):
        return stem[:-1] + suf
    return stem + suf


for w in _OR:
    for e in _ENDINGS:
        PAIRS[_inflect(w, e)] = _inflect(w[:-2] + "our" if w.endswith("or") else w, e)
PAIRS["colorful"] = "colourful"
PAIRS["favorite"], PAIRS["favorites"] = "favourite", "favourites"

_SIMPLE = {
    "center": "centre", "centers": "centres", "centered": "centred", "centering": "centring", "theater": "theatre", "theaters": "theatres", "fiber": "fibre", "fibers": "fibres",
    "liter": "litre", "liters": "litres", "caliber": "calibre", "somber": "sombre", "luster": "lustre", "meager": "meagre", "specter": "spectre", "maneuver": "manoeuvre",
    "maneuvers": "manoeuvres", "defense": "defence", "defenses": "defences", "offense": "offence", "offenses": "offences", "pretense": "pretence",
    "analyze": "analyse", "analyzes": "analyses", "analyzed": "analysed", "analyzing": "analysing", "analyzer": "analyser", "paralyze": "paralyse", "paralyzed": "paralysed",
    "catalyze": "catalyse", "fulfill": "fulfil", "fulfillment": "fulfilment", "enroll": "enrol", "enrollment": "enrolment", "enrolled": "enrolled", "skillful": "skilful", "skillfully": "skilfully",
    "installment": "instalment", "installments": "instalments", "jewelry": "jewellery", "jeweler": "jeweller", "mom": "mum", "moms": "mums", "skeptic": "sceptic", "skeptical": "sceptical",
    "skeptics": "sceptics", "skepticism": "scepticism", "plow": "plough", "plows": "ploughs", "plowed": "ploughed", "aluminum": "aluminium", "pajamas": "pyjamas", "cozy": "cosy",
    "gray": "grey", "grays": "greys", "grayed": "greyed", "mold": "mould", "molds": "moulds", "molded": "moulded", "molding": "moulding", "airplane": "aeroplane", "airplanes": "aeroplanes",
    "sulfur": "sulphur", "pediatric": "paediatric", "pediatrician": "paediatrician", "anesthetic": "anaesthetic", "anesthesia": "anaesthesia", "estrogen": "oestrogen", "fetus": "foetus",
    "encyclopedia": "encyclopaedia", "diarrhea": "diarrhoea", "ax": "axe", "tire": "tyre", "tires": "tyres", "curb": "kerb", "draft": "draught", "check": "cheque",
}
# only these are plainly American-only; ones with another meaning in British English (tire, curb, draft, check, program, ax) are accepted, not flagged
AMBIGUOUS = {"tire", "tires", "curb", "draft", "check", "ax", "mold", "molds", "molded", "molding", "liter", "liters"}
for a, b in _SIMPLE.items():
    if a not in AMBIGUOUS:
        PAIRS.setdefault(a, b)
for stem in ("travel", "cancel", "label", "model", "level", "signal", "fuel", "marvel", "quarrel", "channel", "tunnel", "shovel", "dial", "pedal", "rival", "total", "equal"):
    for suf in ("ed", "ing", "er", "ers"):
        PAIRS.setdefault(stem + suf, stem + "l" + suf)
for suf in ("or", "ors", "ed", "ing"):
    PAIRS.setdefault("counsel" + suf, "counsell" + suf)

GB_WORDS = set(PAIRS.values()) | {v for a, v in _SIMPLE.items() if a in AMBIGUOUS} | {"whilst", "amongst", "grey", "programme", "programmes", "kerb", "tyre", "tyres", "cheque", "cheques", "draught"}

# ── accept other British spellings the pairs don't list, by turning them back into the American word ──
_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"our(?=(s|ed|ing|ful|fully|less|able|ably|ite|ites|ist|ists|y|er|ers|hood|ly|ize|ise)?$)"), "or"),
    (re.compile(r"is(?=(e|ed|es|ing|ation|ations|er|ers)$)"), "iz"),
    (re.compile(r"ys(?=(e|ed|es|ing)$)"), "yz"),
    (re.compile(r"re(?=(s|d)?$)"), "er"),
    (re.compile(r"ogue(?=s?$)"), "og"),
    (re.compile(r"ence(?=s?$)"), "ense"),
    (re.compile(r"(?<=[aeiou])ll(?=(ed|ing|er|ers|or|ors)$)"), "l"),
    (re.compile(r"ae"), "e"),
    (re.compile(r"oe(?!u)"), "e"),
    (re.compile(r"oeu"), "eu"),
]
_SPECIAL = {"fulfil": "fulfill", "enrol": "enroll", "skilful": "skillful", "instalment": "installment", "whilst": "while", "amongst": "among", "sulphur": "sulfur"}


def british_ok(word: str, known) -> bool:
    """True if `word` (lower case, not in the American dictionary) is a valid British spelling. `known` tells whether a word is in the dictionary."""
    w = word.lower()
    if w in GB_WORDS:
        return True
    if w in _SPECIAL:
        return True
    for rx, rep in _RULES:
        m = rx.search(w)
        if m:
            cand = w[:m.start()] + rep + w[m.end():]
            if cand != w and known(cand):
                return True
    return False


def american_only(word: str) -> str | None:
    """The British spelling to suggest for a plainly American one, or None."""
    return PAIRS.get(word.lower())


_REVERSE = {b: a for a, b in PAIRS.items()}
_REVERSE.update({"programme": "program", "kerb": "curb", "tyre": "tire", "cheque": "check", "draught": "draft", "whilst": "while", "amongst": "among", "mum": "mom"})


def to_american(word: str, known) -> str | None:
    """The American spelling of a British word, for suggestions in US English."""
    w = word.lower()
    if w in _REVERSE:
        return _REVERSE[w]
    if w in _SPECIAL:
        return _SPECIAL[w]
    for rx, rep in _RULES:
        m = rx.search(w)
        if m:
            cand = w[:m.start()] + rep + w[m.end():]
            if cand != w and known(cand):
                return cand
    return None
