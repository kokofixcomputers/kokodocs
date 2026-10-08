"""The spell checker's word lists: everyday English plus software vocabulary are accepted, real typos still are not. Run from backend/ (no server needed)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from app.proofread import local_check
ok = lambda n, c, *_: print(('PASS ' if c else 'FAIL ') + n, *([] if c else _))
bad = lambda text, lang='en-US': [text[i['offset']:i['offset'] + i['length']] for i in local_check(0, text, lang) if i['kind'] == 'spelling']

ok('emojis and typescript are fine', bad('I love emojis and typescript.') == [], bad('I love emojis and typescript.'))
tech = 'We use JavaScript, GitHub, Kubernetes, webpack, Postgres, sqlite, Vite, nodejs and markdown with a JSON api.'
ok('software vocabulary is accepted', bad(tech) == [], bad(tech))
common = 'The podcast about smartphones, wifi and selfies was streamed; please unsubscribe and log in to your account.'
ok('modern everyday words are accepted', bad(common) == [], bad(common))
typos = 'I recieve teh definately seperate adress untill thier wierd'
ok('real typos are still caught', set(bad(typos)) >= {'recieve', 'teh', 'definately', 'seperate', 'adress', 'untill', 'thier', 'wierd'}, bad(typos))
ok('a made-up word is still caught', bad('This is a flurbnoxious day') == ['flurbnoxious'])
ok('suggestions still work', 'receive' in next(i['suggestions'] for i in local_check(0, 'Please recieve this', 'en-US') if i['kind'] == 'spelling'))
ok('American English still flags British spellings', bad('The colour of the neighbour') == ['colour', 'neighbour'])
ok('British English accepts them', bad('The colour of the neighbour', 'en-GB') == [])
ok('British-only words are accepted in British English', bad('We shall go whilst the cinema is open, innit', 'en-GB') in ([], ['innit']))
