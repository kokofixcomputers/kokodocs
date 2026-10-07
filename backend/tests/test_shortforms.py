"""Short forms the built-in spell checker must leave alone (no server needed): python tests/test_shortforms.py from backend/."""
import sys
sys.path.insert(0, ".")
from app.proofread import local_check
n = bad = 0
def ok(name, c, *info):
    global n, bad
    n += 1
    if not c: bad += 1; print("FAIL", name, *info)
spell = lambda t, lang="en-US": [t[i["offset"]:i["offset"] + i["length"]] for i in local_check(1, t, lang) if i["kind"] == "spelling"]

ok("units are fine", spell("The trail is 12 km long, 40 cm wide, 3 ft deep and 2 mm thick, and weighs 5 kg.") == [])
ok("more units", spell("Top speed 120 mph, 8 GB of memory, 3.2 GHz, 50 ml, 20 lbs, 15 oz, 60 fps at 300 dpi.") == [])
ok("attached to a number", spell("Run 5km, finish by 10am or 3pm, a 4x faster 2nd place and the 21st, 22nd, 23rd, 24th.") == [])
ok("mixed case", spell("It draws 4 kWh, 2000 mAh, 25 dB and 100 Mbps.") == [])
ok("everyday abbreviations", spell("Bring pens, paper, etc. and approx. 20 copies; see dept. info and the avg. cost, esp. in Jan, Feb and Sept.") == [])
ok("titles and company endings", spell("Dr. Lee and Prof. Chen of Acme Corp. Ltd. Mrs. Ito, Jr. and Sr.") == [])
ok("it works in the other English variants too", spell("A 5 km run, 3 ft up.", "en-GB") == [] and spell("A 5 km run, 3 ft up.", "en-CA") == [])
ok("real misspellings are still caught", spell("This is wrongg and kmm too.") == ["wrongg", "kmm"], spell("This is wrongg and kmm too."))
ok("a word glued to a number that is not a short form is still caught", spell("It has 5kmx and 9wrongg.") == ["kmx", "wrongg"], spell("It has 5kmx and 9wrongg."))
print(f"{n - bad} passed, {bad} failed")
sys.exit(1 if bad else 0)
