"""What a speech model makes up from silence is thrown away. Runs in-process."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.stt import clean_transcript as c
fails = 0
def ok(n, cond):
    global fails; print(("PASS " if cond else "FAIL ") + n); fails += 0 if cond else 1
ok("outro alone is dropped", c("Thank you so much for watching.") == "")
ok("outro plus loop is dropped", c("Thank you very much for your time, and I'll see you in the next video, " + "bye bye, " * 60 + "bye") in ("", "Thank you very much for your time, and I'll see you in the next video, bye bye,") or c("Thank you very much for your time, and I'll see you in the next video, " + "bye bye, " * 60 + "bye") == "")
long = "It has recently been brought to my attention that the sales reps have not logged their calls. I have also learned that some do not check the file."
ok("real speech is untouched", c(long) == long)
ok("real speech with an outro keeps the speech", c(long + " Thank you for watching.") == long)
ok("repetition collapses to one", c("we should go bye bye bye bye bye bye bye bye now") == "we should go bye now")
ok("a short real phrase stays", c("Thank you for the update, Maria.") == "Thank you for the update, Maria.")
ok("a lone filler is dropped", c("you") == "" and c("Thank you.") == "")
ok("normal repeats stay", c("no no no, I said maybe") == "no no no, I said maybe")
print("fails", fails); sys.exit(1 if fails else 0)
