"""Backend checks for the assistant: encrypted settings, SSRF guard, streaming proxy, conversations, permissions."""
import json, os, sqlite3, subprocess, sys, time, urllib.request, urllib.error, uuid

B = "http://127.0.0.1:8000"
MOCK = "http://127.0.0.1:8765/v1"
ok = lambda n, x: print(("PASS " if x else "FAIL ") + n)

def call(m, p, b=None, t=None, raw=False):
    h = {"content-type": "application/json"}
    if t: h["authorization"] = "Bearer " + t
    r = urllib.request.Request(B + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers=h)
    try:
        with urllib.request.urlopen(r) as f:
            d = f.read(); return f.status, (d if raw else json.loads(d))
    except urllib.error.HTTPError as e:
        d = e.read(); return e.code, (d if raw else json.loads(d or b"{}"))

su = lambda e, n: call("POST", "/api/auth/signup", {"email": e, "name": n, "password": "password123"})[1]["token"]
o, b = su("o@x.com", "Olivia"), su("b@x.com", "Ben")
def put_settings(body, tok):
    """The old one-connection call, on top of the list of models: edit the person's own model, or add the first."""
    cur = call("GET", "/api/ai/settings", t=tok)[1]; own = [m for m in cur["models"] if m["scope"] == "user"]
    s, r = call("PUT", f"/api/ai/connections/{own[0]['id']}", body, tok) if own else call("POST", "/api/ai/connections", body, tok)
    if s != 200: return s, r
    me = [m for m in r["models"] if m["scope"] == "user"][0]
    return s, {**r, "source": "user", "key_hint": me["key_hint"], "model": me["model"]}
detail = lambda r: r.get("detail") if isinstance(r, dict) else r

ok("not configured at first", call("GET", "/api/ai/settings", t=o)[1]["configured"] is False)
ok("chat before setup -> 409", call("POST", "/api/ai/chat", {"messages": [{"role": "user", "content": "hi"}]}, o)[0] == 409)
ok("settings need login", call("GET", "/api/ai/settings")[0] == 401)

# SSRF guard (default config forbids private hosts / http)
for url in ["http://169.254.169.254/latest", "https://localhost/v1", "https://127.0.0.1/v1", "ftp://x.com", "https://user:pw@api.mistral.ai/v1", "not a url"]:
    s, r = put_settings({"base_url": url, "model": "m", "api_key": "k"}, o)
    ok(f"blocked: {url}", s == 422)

# valid connection to the (local) mock
s, r = put_settings({"base_url": MOCK, "model": "mock-large", "api_key": "sk-test"}, o)
ok("save settings", s == 200 and r["configured"] and r["source"] == "user" and r["key_hint"] == "…test" and "api_key" not in r)
s, r = call("GET", "/api/ai/settings", t=o); ok("key never returned", "sk-test" not in json.dumps(r))
raw = sqlite3.connect(os.environ.get("KOKO_DATA_DIR", "data") + "/kokodocs.sqlite3").execute("select key_enc, base_url from ai_models where scope = 'user'").fetchone()
ok("api key encrypted at rest", raw[0] and "sk-test" not in raw[0] and raw[0].startswith("gAAAA"))
ok("other users see nothing of it", call("GET", "/api/ai/settings", t=b)[1]["configured"] is False)
s, r = call("GET", "/api/ai/models", t=o); ok("model list from provider", s == 200 and r["models"] == ["mock-large", "mock-small"])
s, r = put_settings({"base_url": MOCK, "model": "mock-small"}, o); ok("update keeps stored key when omitted", s == 200 and r["key_hint"] == "…test" and r["model"] == "mock-small")
put_settings({"base_url": MOCK, "model": "mock-large"}, o)

def stream(msgs, tools=None, token=o):
    body = json.dumps({"messages": msgs, "tools": tools}).encode()
    r = urllib.request.Request(B + "/api/ai/chat", data=body, headers={"content-type": "application/json", "authorization": "Bearer " + token}, method="POST")
    try:
        with urllib.request.urlopen(r) as f:
            ctype = f.headers.get("content-type"); xab = f.headers.get("x-accel-buffering")
            events = [json.loads(l[6:]) for l in f.read().decode().splitlines() if l.startswith("data: ") and l != "data: [DONE]"]
            return f.status, ctype, xab, events
    except urllib.error.HTTPError as e:
        return e.code, None, None, json.loads(e.read() or b"{}")

s, ctype, xab, ev = stream([{"role": "user", "content": "SAY: Hello **world**"}], [{"type": "function", "function": {"name": "read_document", "parameters": {"type": "object", "properties": {}}}}])
text = "".join(e["choices"][0]["delta"].get("content", "") for e in ev)
ok("chat streams SSE through the proxy", s == 200 and ctype.startswith("text/event-stream") and xab == "no" and text == "Hello **world**")
s, _, _, ev = stream([{"role": "user", "content": 'CALL read_document {"x": 1}\nCALL get_selection {}'}])
names = {}
for e in ev:
    for tc in e["choices"][0]["delta"].get("tool_calls", []) or []:
        n = names.setdefault(tc["index"], {"name": "", "args": ""}); n["name"] += tc.get("function", {}).get("name", ""); n["args"] += tc.get("function", {}).get("arguments", "")
ok("tool calls stream through intact", [v["name"] for v in names.values()] == ["read_document", "get_selection"] and json.loads(names[0]["args"]) == {"x": 1})
s, _, _, ev = stream([{"role": "user", "content": "x"}, {"role": "assistant", "content": None, "tool_calls": [{"id": "c", "type": "function", "function": {"name": "read_document", "arguments": "{}"}}]}, {"role": "tool", "tool_call_id": "c", "content": "DOC TEXT"}])
ok("tool results reach the model", "DOC TEXT" in "".join(e["choices"][0]["delta"].get("content", "") for e in ev))
put_settings({"base_url": MOCK, "model": "missing-model"}, o)
s, _, _, ev = stream([{"role": "user", "content": "hi"}]); ok("provider error is relayed readably", s == 502 and "does not exist" in ev["detail"]); print("   ->", ev["detail"][:90])
put_settings({"base_url": MOCK, "model": "mock-large", "api_key": "wrong"}, o)
s, _, _, ev = stream([{"role": "user", "content": "hi"}]); ok("bad API key explained", s == 502 and "rejected the API key" in ev["detail"])
put_settings({"base_url": MOCK, "model": "mock-large", "api_key": "sk-test"}, o)
ok("clearing the key works", put_settings({"base_url": MOCK, "model": "mock-large", "api_key": ""}, o)[1]["key_hint"] is None)
put_settings({"base_url": MOCK, "model": "mock-large", "api_key": "sk-test"}, o)

# conversations: per user, per document
d = call("POST", "/api/docs", {}, o)[1]["id"]; cid = uuid.uuid4().hex[:12]
data = [{"kind": "user", "text": "Hi"}, {"kind": "assistant", "text": "Hello **there**"}]
ok("save conversation", call("PUT", f"/api/docs/{d}/ai/conversations/{cid}", {"title": "Greeting", "data": data}, o)[0] == 200)
ok("list conversations", [c["title"] for c in call("GET", f"/api/docs/{d}/ai/conversations", t=o)[1]] == ["Greeting"])
ok("load conversation", call("GET", f"/api/docs/{d}/ai/conversations/{cid}", t=o)[1]["data"] == data)
ok("other user cannot read the doc's chats", call("GET", f"/api/docs/{d}/ai/conversations", t=b)[0] == 403)
call("PUT", f"/api/docs/{d}/sharing", {"link_access": "restricted", "link_role": "viewer", "shares": [{"email": "b@x.com", "role": "viewer"}]}, o)
ok("collaborator sees none of someone else's chats", call("GET", f"/api/docs/{d}/ai/conversations", t=b)[1] == [] and call("GET", f"/api/docs/{d}/ai/conversations/{cid}", t=b)[0] == 404)
ok("collaborator cannot overwrite someone else's id", call("PUT", f"/api/docs/{d}/ai/conversations/{cid}", {"title": "x", "data": []}, b)[0] == 404)
call("PUT", f"/api/docs/{d}/ai/conversations/{cid}", {"title": "Renamed", "data": data + [{"kind": "user", "text": "More"}]}, o)
ok("update conversation", call("GET", f"/api/docs/{d}/ai/conversations/{cid}", t=o)[1]["title"] == "Renamed")
ok("delete conversation", call("DELETE", f"/api/docs/{d}/ai/conversations/{cid}", t=o)[0] == 200 and call("GET", f"/api/docs/{d}/ai/conversations", t=o)[1] == [])
for i in range(55): call("PUT", f"/api/docs/{d}/ai/conversations/c{i:04d}x", {"title": f"t{i}", "data": []}, o)
ok("keeps the newest 50 conversations", len(call("GET", f"/api/docs/{d}/ai/conversations", t=o)[1]) == 50)
call("DELETE", f"/api/docs/{d}", t=o); call("POST", f"/api/docs/{d}/restore", t=o)
ok("rate limit eventually applies", any(stream([{"role": "user", "content": "SAY: x"}])[0] == 429 for _ in range(45)))
