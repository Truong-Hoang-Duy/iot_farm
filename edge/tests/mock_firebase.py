# -*- coding: utf-8 -*-
"""Mock Firebase Realtime Database REST (chỉ dùng thư viện chuẩn) để test offline.

Hỗ trợ:
  GET/PUT/PATCH/POST/DELETE trên đường dẫn `*.json` (cây JSON trong bộ nhớ),
  PATCH multi-path (key chứa '/'), POST sinh push-id, `{".sv":"timestamp"}`,
  null = xoá nút. Giả lập Firebase Auth REST:
    POST /__auth/v1/accounts:signInWithPassword?key=...
    POST /__auth/v1/token?key=...   (grant_type=refresh_token)
Giả lập sự cố:
  set_mode("ok" | "503" | "drop")  – 503: trả lỗi; drop: đóng kết nối không trả lời
  stop_listening()/start_listening() – tắt hẳn cổng (TCP bị từ chối)
Chạy độc lập:  python mock_firebase.py --port 9000 [--require-auth]
  admin: GET /__admin/mode?set=503|ok|drop , GET /__admin/dump
"""
import argparse
import copy
import json
import random
import socket
import string
import threading
import time

try:
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from socketserver import ThreadingMixIn
    from urllib.parse import parse_qs, unquote, urlsplit
except ImportError:  # pragma: no cover
    raise

PUSH_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz"


class _PushId(object):
    def __init__(self):
        self.last_ts = 0
        self.last_rand = [0] * 12
        self.lock = threading.Lock()

    def next(self):
        with self.lock:
            now = int(time.time() * 1000)
            dup = now == self.last_ts
            self.last_ts = now
            ts_chars = []
            for _ in range(8):
                ts_chars.append(PUSH_CHARS[now % 64])
                now //= 64
            out = "".join(reversed(ts_chars))
            if not dup:
                self.last_rand = [random.randint(0, 63) for _ in range(12)]
            else:
                i = 11
                while i >= 0 and self.last_rand[i] == 63:
                    self.last_rand[i] = 0
                    i -= 1
                if i >= 0:
                    self.last_rand[i] += 1
            return out + "".join(PUSH_CHARS[c] for c in self.last_rand)


def resolve_server_values(value, now_ms):
    if isinstance(value, dict):
        if value == {".sv": "timestamp"}:
            return now_ms
        return dict((k, resolve_server_values(v, now_ms)) for k, v in value.items())
    if isinstance(value, list):
        return [resolve_server_values(v, now_ms) for v in value]
    return value


def _split(path):
    return [unquote(p) for p in path.strip("/").split("/") if p]


class _ThreadingServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class MockFirebase(object):
    def __init__(self, host="127.0.0.1", port=0, require_auth=False, token_ttl=3600):
        self.host = host
        self.port = port
        self.require_auth = require_auth
        self.token_ttl = token_ttl
        self.tree = {}
        self.mode = "ok"
        self.lock = threading.RLock()
        self.requests = []  # (time, method, path, status)
        self.users = {}
        self.tokens = {}  # idToken -> expiry
        self.refresh_tokens = {}
        self._push = _PushId()
        self._server = None
        self._thread = None

    # --------------------------------------------------------------- tree ops
    def get(self, path=""):
        with self.lock:
            node = self.tree
            for p in _split(path):
                if not isinstance(node, dict) or p not in node:
                    return None
                node = node[p]
            return copy.deepcopy(node)

    def set(self, path, value):
        with self.lock:
            parts = _split(path)
            value = resolve_server_values(copy.deepcopy(value), int(time.time() * 1000))
            if not parts:
                self.tree = value if isinstance(value, dict) else {}
                return
            if value is None:
                self._delete(parts)
                return
            node = self.tree
            for p in parts[:-1]:
                if not isinstance(node.get(p), dict):
                    node[p] = {}
                node = node[p]
            if isinstance(value, dict):
                value = self._strip_nulls(value)
                if not value:
                    self._delete(parts)
                    return
            node[parts[-1]] = value

    def _strip_nulls(self, d):
        out = {}
        for k, v in d.items():
            if isinstance(v, dict):
                v = self._strip_nulls(v)
                if not v:
                    continue
            if v is None:
                continue
            out[k] = v
        return out

    def _delete(self, parts):
        stack = []
        node = self.tree
        for p in parts[:-1]:
            if not isinstance(node, dict) or p not in node:
                return
            stack.append((node, p))
            node = node[p]
        if isinstance(node, dict):
            node.pop(parts[-1], None)
        # dọn các nút cha rỗng
        while stack:
            parent, key = stack.pop()
            if isinstance(parent.get(key), dict) and not parent[key]:
                del parent[key]
            else:
                break

    def update(self, path, body):
        with self.lock:
            base = path.strip("/")
            for k, v in body.items():
                self.set((base + "/" + k) if base else k, v)

    def push(self, path, value):
        name = self._push.next()
        self.set(path.strip("/") + "/" + name, value)
        return name

    def set_mode(self, mode):
        assert mode in ("ok", "503", "drop")
        self.mode = mode

    def add_user(self, email, password):
        self.users[email] = password

    # -------------------------------------------------------------- lifecycle
    def _make_handler(self):
        mock = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, fmt, *args):  # im lặng
                pass

            def _send(self, status, obj):
                data = json.dumps(obj).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                with mock.lock:
                    mock.requests.append((time.time(), self.command, self.path.split("?")[0], status))

            def _body(self):
                n = int(self.headers.get("Content-Length") or 0)
                return self.rfile.read(n) if n else b""

            def _handle(self):
                url = urlsplit(self.path)
                qs = parse_qs(url.query)
                raw = self._body()
                if url.path.startswith("/__admin/"):
                    return self._admin(url.path, qs)
                if mock.mode == "drop":
                    self.close_connection = True
                    try:
                        self.connection.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                    return
                if mock.mode == "503":
                    return self._send(503, {"error": "Service Unavailable (mock outage)"})
                if url.path.startswith("/__auth/v1/"):
                    return self._auth(url.path, qs, raw)
                if not url.path.endswith(".json"):
                    return self._send(404, {"error": "path must end with .json"})
                if mock.require_auth:
                    tok = (qs.get("auth") or [None])[0]
                    exp = mock.tokens.get(tok)
                    if exp is None or exp < time.time():
                        return self._send(401, {"error": "Permission denied"})
                path = url.path[: -len(".json")]
                try:
                    body = json.loads(raw.decode("utf-8")) if raw else None
                except ValueError:
                    return self._send(400, {"error": "Invalid data; couldn't parse JSON object."})
                m = self.command
                if m == "GET":
                    return self._send(200, mock.get(path))
                if m == "PUT":
                    mock.set(path, body)
                    return self._send(200, mock.get(path))
                if m == "PATCH":
                    if not isinstance(body, dict):
                        return self._send(400, {"error": "PATCH body must be an object"})
                    mock.update(path, body)
                    return self._send(200, resolve_server_values(body, int(time.time() * 1000)))
                if m == "POST":
                    return self._send(200, {"name": mock.push(path, body)})
                if m == "DELETE":
                    mock.set(path, None)
                    return self._send(200, None)
                return self._send(405, {"error": "method not allowed"})

            def _auth(self, path, qs, raw):
                if path.endswith("accounts:signInWithPassword"):
                    try:
                        b = json.loads(raw.decode("utf-8"))
                    except ValueError:
                        b = {}
                    email, pw = b.get("email"), b.get("password")
                    if mock.users.get(email) != pw or not email:
                        return self._send(400, {"error": {"code": 400, "message": "INVALID_LOGIN_CREDENTIALS"}})
                    tok = "id-" + "".join(random.choice(string.ascii_letters) for _ in range(24))
                    ref = "rf-" + "".join(random.choice(string.ascii_letters) for _ in range(24))
                    mock.tokens[tok] = time.time() + mock.token_ttl
                    mock.refresh_tokens[ref] = email
                    return self._send(200, {"idToken": tok, "refreshToken": ref,
                                            "expiresIn": str(mock.token_ttl), "localId": "uid-" + email})
                if path.endswith("/token"):
                    form = parse_qs(raw.decode("utf-8"))
                    ref = (form.get("refresh_token") or [None])[0]
                    if ref not in mock.refresh_tokens:
                        return self._send(400, {"error": {"code": 400, "message": "INVALID_REFRESH_TOKEN"}})
                    tok = "id-" + "".join(random.choice(string.ascii_letters) for _ in range(24))
                    mock.tokens[tok] = time.time() + mock.token_ttl
                    return self._send(200, {"id_token": tok, "refresh_token": ref,
                                            "expires_in": str(mock.token_ttl)})
                return self._send(404, {"error": "unknown auth endpoint"})

            def _admin(self, path, qs):
                if path == "/__admin/mode":
                    mode = (qs.get("set") or [""])[0]
                    if mode:
                        mock.set_mode(mode)
                    return self._send(200, {"mode": mock.mode})
                if path == "/__admin/dump":
                    return self._send(200, mock.get(""))
                return self._send(404, {"error": "unknown admin"})

            def do_GET(self):
                self._handle()

            do_PUT = do_PATCH = do_POST = do_DELETE = do_GET

        return Handler

    def start_listening(self):
        self._server = _ThreadingServer((self.host, self.port), self._make_handler())
        self.port = self._server.server_address[1]
        self._thread = threading.Thread(target=self._server.serve_forever, name="mock-firebase")
        self._thread.daemon = True
        self._thread.start()
        return self

    start = start_listening

    def stop_listening(self):
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None

    stop = stop_listening

    @property
    def url(self):
        return "http://%s:%d" % (self.host, self.port)


def main():
    ap = argparse.ArgumentParser(description="Mock Firebase RTDB REST server")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=9000)
    ap.add_argument("--require-auth", action="store_true")
    ap.add_argument("--user", action="append", default=[], help="email:password (cho --require-auth)")
    ap.add_argument("--seed", action="store_true", help="tạo sẵn streaming/config mẫu")
    a = ap.parse_args()
    m = MockFirebase(a.host, a.port, require_auth=a.require_auth)
    for u in a.user:
        email, _, pw = u.partition(":")
        m.add_user(email, pw)
    if a.seed:
        m.set("streaming", {
            "config": {"sampling_interval_sec": 5, "irrigation_mode": 0, "light_mode": 0,
                       "irrigation_time": {"time1": 6, "time2": 17}, "light_time": {"on": 6, "off": 18},
                       "threshold": {"soil_moisture": {"low": 40, "high": 80}}},
            "control": {"pump": {"status": False}, "light": {"status": False}},
        })
    m.start()
    print("Mock Firebase đang chạy tại %s (Ctrl+C để dừng)" % m.url)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        m.stop()


if __name__ == "__main__":
    main()
