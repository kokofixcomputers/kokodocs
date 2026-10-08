"""Cloudflare Workers AI: speech (ai/run) and the model list for Koko, against a fake of the REST API."""
import asyncio, base64, json, os, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from fastapi import HTTPException
from app import ai, stt

SEEN = []
ACCT = "0123456789abcdef0123456789abcdef"


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", 0)))
        SEEN.append({"path": self.path, "auth": self.headers.get("authorization"), "ctype": self.headers.get("content-type"), "body": body})
        code, out = (401, {"success": False, "errors": [{"message": "bad token"}]}) if self.headers.get("authorization") == "Bearer bad" else (200, {"success": True, "result": {"text": " hello cloudflare "}})
        if "/gpt-oss" in self.path:   # what Workers AI really sent for a reasoning model that ran out of tokens
            code, out = 200, {"result": {"object": "chat.completion", "choices": [{"index": 0, "message": {"role": "assistant", "content": None, "tool_calls": [], "reasoning_content": "We need to write"}, "finish_reason": "length"}]}, "success": True, "errors": [], "messages": []}
        elif "/openai-ok" in self.path:
            code, out = 200, {"result": {"choices": [{"message": {"role": "assistant", "content": "All set.", "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "read_deck", "arguments": "{}"}}]}, "finish_reason": "tool_calls"}]}, "success": True}
        elif "/native" in self.path:
            code, out = 200, {"result": {"response": None, "tool_calls": [{"name": "add_slide", "arguments": {"layout": "blank"}}]}, "success": True}
        elif "/boom" in self.path:
            code, out = 400, {"success": False, "errors": [{"message": "Bad input: messages required"}]}
        self.send_response(code); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(out).encode())

    def do_GET(self):
        SEEN.append({"path": self.path, "auth": self.headers.get("authorization")})
        code, out = (403, {"errors": [{"message": "nope"}]}) if self.headers.get("authorization") == "Bearer bad" else (200, {"result": [{"name": "@cf/meta/llama-3.3-70b-instruct-fp8-fast"}, {"name": "@cf/qwen/qwen3-30b-a3b-fp8"}]})
        self.send_response(code); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(out).encode())


srv = HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_port}"
stt.CF_URL = base + "/client/v4/accounts/{account}/ai/run/{model}"
ok = True
def check(name, cond):
    global ok; ok &= bool(cond); print("PASS" if cond else "FAIL", name)

wav = b"RIFFxxxxWAVEfmt "
turbo = stt.Cfg("cloudflare", "@cf/openai/whisper-large-v3-turbo", None, "tok", None, ACCT)
check("not ready without an account id", not stt.Cfg("cloudflare", "m", None, "tok", None, "").ready)
check("not ready without a token", not stt.Cfg("cloudflare", "m", None, "", None, ACCT).ready)
check("ready with both", turbo.ready)
t = asyncio.run(stt._cloudflare(turbo, wav, "en"))
s = SEEN[-1]
check("turbo: text comes back trimmed", t == "hello cloudflare")
check("turbo: right path", s["path"] == f"/client/v4/accounts/{ACCT}/ai/run/@cf/openai/whisper-large-v3-turbo")
check("turbo: bearer token", s["auth"] == "Bearer tok")
j = json.loads(s["body"])
check("turbo: base64 audio and language in JSON", base64.b64decode(j["audio"]) == wav and j["language"] == "en" and s["ctype"] == "application/json")
asyncio.run(stt._cloudflare(stt.Cfg("cloudflare", "@cf/openai/whisper", None, "tok", None, ACCT), wav, "en"))
s = SEEN[-1]
check("whisper: raw bytes", s["body"] == wav and s["ctype"] == "application/octet-stream")
try:
    asyncio.run(stt._cloudflare(stt.Cfg("cloudflare", "@cf/openai/whisper", None, "bad", None, ACCT), wav, None)); check("bad token raises", False)
except stt.STTError as e:
    check("bad token gives a clear message", "rejected" in str(e))
try:
    asyncio.run(stt._cloudflare(stt.Cfg("cloudflare", "@cf/openai/whisper", None, "tok", None, "../evil"), wav, None)); check("bad account id raises", False)
except stt.STTError:
    check("account id is cleaned, an invalid one refused", True)
check("provider is listed", "cloudflare" in stt.PROVIDERS and stt.DEFAULT_MODEL["cloudflare"] in stt.CF_MODELS)

# Koko's side: the model list comes from the catalogue, since the OpenAI-compatible address has no /models
names = asyncio.run(ai._cloudflare_models(base + f"/client/v4/accounts/{ACCT}", {"base_url": "x", "api_key": "tok"}))
check("model list", names == ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/qwen/qwen3-30b-a3b-fp8"])
check("asks for text generation models", "task=Text+Generation" in SEEN[-1]["path"] or "task=Text%20Generation" in SEEN[-1]["path"])
try:
    asyncio.run(ai._cloudflare_models(base + f"/client/v4/accounts/{ACCT}", {"base_url": "x", "api_key": "bad"})); check("bad token raises", False)
except HTTPException as e:
    check("model list: bad token explained", "Workers AI permission" in e.detail)
async def via_fetch():
    return await ai.fetch_models({"base_url": f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/ai/v1", "api_key": "tok"})
orig = ai._cloudflare_models
async def fake(url, s): return [url]
ai._cloudflare_models = fake
r = asyncio.run(via_fetch())
check("fetch_models routes the Workers AI address to the catalogue", r == [f"https://api.cloudflare.com/client/v4/accounts/{ACCT}"])

# Koko's chat through the REST API (ai/run), in the shapes Cloudflare really returns
class Body:
    messages = [{"role": "user", "content": "hi"}]; tools = [{"type": "function", "function": {"name": "x"}}]; temperature = None
acct = base + f"/client/v4/accounts/{ACCT}"
def run(model, key="tok"): return asyncio.run(ai._cloudflare_run(acct, {"model": model, "api_key": key}, Body))
try:
    run("@cf/openai/gpt-oss-20b"); check("a reasoning model that runs out of room raises", False)
except HTTPException as e:
    check("a reasoning model that runs out of room is explained, not shown as an empty reply", "room" in e.detail)
sent = json.loads(SEEN[-1]["body"])
check("max_tokens is raised from Cloudflare's tiny default; messages and tools are passed", sent["max_tokens"] == ai.CF_MAX_TOKENS > 256 and sent["messages"][0]["content"] == "hi" and sent["tools"])
check("sent to /ai/run/<model> with the token", SEEN[-1]["path"].endswith("/ai/run/@cf/openai/gpt-oss-20b") and SEEN[-1]["auth"] == "Bearer tok")
r = run("@cf/x/openai-ok")["choices"][0]
check("OpenAI-shaped result: text and tool call", r["message"]["content"] == "All set." and r["message"]["tool_calls"][0]["function"]["name"] == "read_deck" and r["finish_reason"] == "tool_calls")
r = run("@cf/x/native")["choices"][0]
tc = r["message"]["tool_calls"][0]
check("native result: tool call with dict arguments becomes JSON text with an id", tc["function"]["name"] == "add_slide" and json.loads(tc["function"]["arguments"]) == {"layout": "blank"} and tc["id"] and r["message"]["content"] is None)
try:
    run("@cf/x/boom"); check("errors raise", False)
except HTTPException as e:
    check("Cloudflare's own error message is passed on", "messages required" in e.detail)
try:
    run("@cf/x/plain", "bad"); check("bad token raises", False)
except HTTPException as e:
    check("bad token: says what permission is needed", "Workers AI permission" in e.detail)
for u, good in [(f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/ai", True), (f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/ai/v1", True), ("https://api.cloudflare.com/client/v4/accounts//ai", False), ("https://api.cloudflare.com/client/v4/accounts/abc/ai/v1", False)]:
    try:
        asyncio.run(ai.check_url(u)); got = True
    except HTTPException:
        got = False
    check(f"address {u[-30:]} {'accepted' if good else 'refused'}", got == good)
sys.exit(0 if ok else 1)
