"""Tiny SMTP sink for testing email: `python tests/mock_smtp.py 2525` writes each message to /tmp/mock_mail.jsonl. No TLS or auth required."""
import json, socketserver, sys

class H(socketserver.StreamRequestHandler):
    def send(self, s): self.wfile.write((s + "\r\n").encode()); self.wfile.flush()
    def handle(self):
        self.send("220 mock ready"); frm, rcpt = "", []
        while True:
            line = self.rfile.readline().decode(errors="replace").strip()
            if not line: return
            cmd = line.split(" ")[0].upper()
            if cmd in ("EHLO", "HELO"): self.send("250-mock"); self.send("250 AUTH PLAIN LOGIN")
            elif cmd == "AUTH": self.send("235 ok")
            elif cmd == "MAIL": frm = line; self.send("250 ok")
            elif cmd == "RCPT": rcpt.append(line.split(":", 1)[1].strip(" <>")); self.send("250 ok")
            elif cmd == "DATA":
                self.send("354 go"); body = []
                while True:
                    l = self.rfile.readline().decode(errors="replace")
                    if l.strip() == ".": break
                    body.append(l)
                open("/tmp/mock_mail.jsonl", "a").write(json.dumps({"to": rcpt, "data": "".join(body)}) + "\n"); self.send("250 queued"); rcpt = []
            elif cmd == "QUIT": self.send("221 bye"); return
            else: self.send("250 ok")

class S(socketserver.ThreadingTCPServer): allow_reuse_address = True
if __name__ == "__main__": S(("127.0.0.1", int(sys.argv[1] if len(sys.argv) > 1 else 2525)), H).serve_forever()
