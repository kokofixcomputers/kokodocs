"""English variants in the built-in proofreader (no server needed): python tests/test_dialects.py from backend/."""
import sys
sys.path.insert(0, ".")
from app.proofread import local_check
n = bad = 0
def ok(name, c, *info):
    global n, bad
    n += 1
    if not c: bad += 1; print("FAIL", name, *info)
def words(text, lang): return [(text[i["offset"]:i["offset"] + i["length"]], i["suggestions"][:1]) for i in local_check(1, text, lang) if i["kind"] == "spelling"]

GB = "The colour of the centre was organised by my neighbour, with a favourite catalogue, travelling cancelled analysed defence."
for l in ("en-GB", "en-AU", "en-NZ", "en-ZA", "en-IE", "en-IN", "en-CA"):
    ok(f"{l}: British spellings are valid", words(GB, l) == [], words(GB, l))
us = dict((w, s) for w, s in words(GB, "en-US"))
ok("en-US: British spellings are still flagged", {"colour", "centre", "organised", "neighbour", "favourite", "analysed"} <= set(us), us)
ok("en-US: and the American spelling comes first", us["colour"] == ["color"] and us["organised"] == ["organized"] and us["neighbour"] == ["neighbor"], us)
ok("no language given means American", [w for w, _ in words("colour", "")] == ["colour"])

US = "The color of the center was organized by my neighbor, who canceled and analyzed the behavior and honor of travelers."
ok("en-US: American spellings are fine", words(US, "en-US") == [], words(US, "en-US"))
ok("en-CA: American spellings are fine too", words(US, "en-CA") == [], words(US, "en-CA"))
g = dict(words(US, "en-GB"))
ok("en-GB: American-only spellings are flagged with the British form", g.get("color") == ["colour"] and g.get("center") == ["centre"] and g.get("neighbor") == ["neighbour"] and g.get("canceled") == ["cancelled"] and g.get("analyzed") == ["analysed"] and g.get("honor") == ["honour"] and g.get("travelers") == ["travellers"], g)
ok("en-GB: -ize is accepted (Oxford spelling)", words("They organized and recognized it.", "en-GB") == [], words("They organized and recognized it.", "en-GB"))
ok("en-GB: words that only look American are not flagged", words("Pick a tire, a check and a draft program.", "en-GB") == [], words("Pick a tire, a check and a draft program.", "en-GB"))
ok("capital letters carry over", dict(words("Color matters. Colour matters.", "en-GB")).get("Color") == ["Colour"], words("Color matters.", "en-GB"))
ok("real typos are still caught in every variant", all(words("This is wrongg.", l) for l in ("en-US", "en-GB", "en-CA", "en-AU")))
ok("made-up words that merely end like British ones are caught", words("A doctour and a hoour.", "en-GB") != [], words("A doctour and a hoour.", "en-GB"))
ok("other checks are unaffected", any(i["kind"] == "grammar" for i in local_check(1, "this is is a test", "en-GB")))
print(f"{n - bad} passed, {bad} failed")
sys.exit(1 if bad else 0)
