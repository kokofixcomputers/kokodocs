import sys
sys.path.insert(0, ".")
from app.proofread import local_check

def fix(text):
    """Apply the first suggestion of every issue (right to left) and return the corrected text + issue list."""
    issues = [i for i in local_check(1, text) if i["kind"] != "spelling"]
    out = text
    for i in sorted(issues, key=lambda x: -x["offset"]):
        if i["suggestions"]:
            out = out[: i["offset"]] + i["suggestions"][0] + out[i["offset"] + i["length"] :]
    return out, issues

passed = failed = 0
def want_fixed(src, expected):
    global passed, failed
    got, _ = fix(src)
    if got == expected: passed += 1
    else: failed += 1; print(f"FAIL fix   {src!r}\n     got      {got!r}\n     expected {expected!r}")

def want_clean(src):
    global passed, failed
    _, issues = fix(src)
    if not issues: passed += 1
    else: failed += 1; print(f"FAIL clean {src!r} -> {[(i['message'][:40], src[i['offset']:i['offset']+i['length']]) for i in issues]}")

# ── their / there / they're ──
want_fixed("Their is a problem with the build.", "There is a problem with the build.")
want_fixed("Their are three options.", "There are three options.")
want_fixed("Their going to the store.", "They’re going to the store.")
want_fixed("I think their not coming.", "I think they’re not coming.")
want_fixed("Put it over there car.", "Put it over their car.")
want_fixed("Look at there house.", "Look at their house.")
want_fixed("There going to win.", "They’re going to win.")
want_fixed("They're house is big.", "Their house is big.")
want_fixed("They’re is no reason.", "There is no reason.")
for ok in ["Their car is there.", "They're going to win.", "There is a problem.", "I left my bag over there.", "Their house is big.", "There are many reasons.", "They’re not coming.", "Is there a way?", "Look over there, near their car."]:
    want_clean(ok)

# ── its / it's ──
want_fixed("Its a beautiful day.", "It’s a beautiful day.")
want_fixed("Its going to rain.", "It’s going to rain.")
want_fixed("I think its not ready.", "I think it’s not ready.")
want_fixed("Its late and its cold.", "It’s late and it’s cold.")
want_fixed("Its been a long week.", "It’s been a long week.")
want_fixed("The company lost it's way.", "The company lost its way.")
want_fixed("The dog has it’s own bed.", "The dog has its own bed.")
for ok in ["It's a beautiful day.", "The dog wagged its tail.", "The company lost its way.", "It’s been a long week.", "Its own design is unique.", "The bird built its nest.", "Check its hard drive.", "Its easy-going nature helps."]:
    want_clean(ok)

# ── affect / effect ──
want_fixed("The affect was huge.", "The effect was huge.")
want_fixed("It had a negative affect on sales.", "It had a negative effect on sales.")
want_fixed("There is no affect on performance.", "There is no effect on performance.")
want_fixed("This will effect the outcome.", "This will affect the outcome.")
want_fixed("Weather can effect your mood.", "Weather can affect your mood.")
want_fixed("The delay didn't effect us.", "The delay didn't affect us.")
for ok in ["The effect was huge.", "This will affect the outcome.", "The change had little effect.", "They want to effect change.", "How does it affect you?", "The side effects are mild.", "Her affect was flat."]:
    want_clean(ok)

# ── your / you're ──
want_fixed("Your welcome.", "You’re welcome.")
want_fixed("Your going to love it.", "You’re going to love it.")
want_fixed("I think your right.", "I think you’re right.")
want_fixed("Your the best.", "You’re the best.")
want_fixed("You're car is ready.", "Your car is ready.")
want_fixed("Is this you’re phone?", "Is this your phone?")
for ok in ["You're welcome.", "Your car is ready.", "You’re right about that.", "Is this your phone?", "Thank you for your help.", "You're going to love it."]:
    want_clean(ok)
want_fixed("Their affect on the economy was big.", "Their effect on the economy was big.")

# ── punctuation ──
want_fixed("Hello , world .", "Hello, world.")
want_fixed("Wait ; what ?", "Wait; what?")
want_fixed("I like apples,oranges,and pears.", "I like apples, oranges, and pears.")
want_fixed("It ended.Then we left.", "It ended. Then we left.")
want_fixed("Note:this matters.", "Note: this matters.")
want_fixed("Fine,, thanks.", "Fine, thanks.")
want_fixed("Wait.. what?", "Wait. What?")
want_fixed("Call me ( maybe ).", "Call me (maybe).")
want_fixed("I dont know and I cant help.", "I don't know and I can't help.")
want_fixed("Im sure youre ready.", "I'm sure you're ready.")
for ok in ["Hello, world.", "Visit https://example.com/page now.", "Meet at 10:30 tomorrow.", "Use std::vector here.", "He said (quietly) that it works.", "Wait... what?", "See Node.js and ASP.NET docs.", "Price is $4.50, not $5.", "e.g., apples", "Ready :) now", "1) first item", "What?! No way."]:
    want_clean(ok)

# unbalanced brackets (report only)
_, i = fix("This (is open and [fine]."); print("unclosed paren flagged:", any("Unclosed" in x["message"] for x in i)); passed += any("Unclosed" in x["message"] for x in i); failed += not any("Unclosed" in x["message"] for x in i)
_, i = fix("This is closed) wrongly."); print("stray paren flagged:", any("Unmatched" in x["message"] for x in i)); passed += any("Unmatched" in x["message"] for x in i); failed += not any("Unmatched" in x["message"] for x in i)
print(f"\n{passed} passed, {failed} failed")
