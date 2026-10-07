"""A scripted OpenAI-compatible server for testing the assistant without a real model.

Put lines in the user's message to drive it:
    SAY: some **markdown** reply                -> streams that text
    CALL tool_name {"json": "args"}             -> asks the client to run that tool (several lines = several calls)
After tool results come back it replies "Done. Results: ..." quoting what it received.
"""
import json
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY = "sk-test"


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def authed(self):
        return self.headers.get("authorization") == f"Bearer {KEY}"

    def do_GET(self):
        if not self.authed():
            return self._json(401, {"error": {"message": "Invalid API key"}})
        if self.path.endswith("/models"):
            return self._json(200, {"data": [{"id": "mock-large"}, {"id": "mock-small"}]})
        self._json(404, {"error": {"message": "nope"}})

    def emit(self, delta, finish=None):
        self.wfile.write(b"data: " + json.dumps({"choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}).encode() + b"\n\n")
        self.wfile.flush()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        if not self.authed():
            return self._json(401, {"error": {"message": "Invalid API key"}})
        if body.get("model") == "missing-model":
            return self._json(404, {"error": {"message": "The model `missing-model` does not exist"}})
        msgs = body["messages"]
        self.server.seen.append(body)
        last_user = next((m for m in reversed(msgs) if m["role"] == "user"), {"content": ""})
        text = last_user["content"] if isinstance(last_user["content"], str) else json.dumps(last_user["content"])
        self.send_response(200); self.send_header("content-type", "text/event-stream"); self.send_header("cache-control", "no-cache"); self.end_headers()
        if msgs[-1]["role"] == "tool":
            idx = max(i for i, m in enumerate(msgs) if m["role"] == "user")
            results = [m["content"] for m in msgs[idx + 1:] if m["role"] == "tool"]
            reply = "Done. Results: " + " | ".join(r[:140].replace("\n", " ") for r in results)
            for i in range(0, len(reply), 24):
                self.emit({"content": reply[i:i + 24]}); time.sleep(0.01)
            self.emit({}, "stop")
        else:
            calls = re.findall(r"^CALL (\w+) (\{.*\})\s*$", text, re.M)
            say = re.search(r"^SAY: (.*)$", text, re.M | re.S)
            if calls:
                self.emit({"content": "On it. "})
                for i, (name, args) in enumerate(calls):
                    self.emit({"tool_calls": [{"index": i, "id": f"call_{i}", "type": "function", "function": {"name": name, "arguments": ""}}]})
                    for k in range(0, len(args), 17):
                        self.emit({"tool_calls": [{"index": i, "function": {"arguments": args[k:k + 17]}}]}); time.sleep(0.005)
                self.emit({}, "tool_calls")
            else:
                reply = say.group(1) if say else "Hello! Tools available: " + ", ".join(t["function"]["name"] for t in body.get("tools", []))
                for i in range(0, len(reply), 20):
                    self.emit({"content": reply[i:i + 20]}); time.sleep(0.01)
                self.emit({}, "stop")
        self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()


class S(ThreadingHTTPServer):
    seen: list = []
    daemon_threads = True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    S(("127.0.0.1", port), H).serve_forever()
