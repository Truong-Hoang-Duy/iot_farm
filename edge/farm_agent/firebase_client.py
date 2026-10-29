# -*- coding: utf-8 -*-
"""Client Firebase Realtime Database qua REST (requests) + Firebase Auth REST.

Không dùng firebase-admin (grpc không build được trên Jetson / Python 3.6).

Xác thực (tuỳ chọn): nếu cấu hình đủ api_key + email + password thì đăng nhập
bằng Identity Toolkit `accounts:signInWithPassword`, làm mới bằng Secure Token
`grant_type=refresh_token` trước khi hết hạn, và gắn `?auth=<idToken>` vào mọi
request. Gặp 401/403 -> bỏ token, đăng nhập lại và thử lại đúng 1 lần.
Nếu không cấu hình -> gửi request không xác thực (rules đang mở).
"""
import json
import logging
import threading
import time

import requests

log = logging.getLogger("farm_agent.firebase")

SERVER_TIMESTAMP = {".sv": "timestamp"}


class AuthError(Exception):
    pass


class FirebaseAuth(object):
    def __init__(self, api_key, email, password, identity_url, securetoken_url, timeout=15.0):
        self.api_key = api_key
        self.email = email
        self.password = password
        self.identity_url = identity_url.rstrip("/")
        self.securetoken_url = securetoken_url.rstrip("/")
        self.timeout = timeout
        self.enabled = bool(api_key and email and password)
        self.uid = None
        self._lock = threading.Lock()
        self._token = None
        self._refresh = None
        self._exp_mono = 0.0
        self._ttl = 3600.0
        self._fail_until = 0.0
        self._session = requests.Session()

    def invalidate(self):
        with self._lock:
            self._token = None
            self._exp_mono = 0.0

    def get_token(self):
        if not self.enabled:
            return None
        with self._lock:
            now = time.monotonic()
            margin = min(300.0, self._ttl / 4.0)
            if self._token and now < self._exp_mono - margin:
                return self._token
            if now < self._fail_until:
                raise AuthError("đang chờ thử đăng nhập lại (back-off)")
            try:
                if self._refresh:
                    try:
                        self._do_refresh()
                        return self._token
                    except AuthError as e:
                        log.warning("Làm mới token thất bại (%s) -> đăng nhập lại", e)
                        self._refresh = None
                self._sign_in()
                return self._token
            except AuthError:
                self._fail_until = time.monotonic() + 30.0
                raise

    def _post(self, url, **kwargs):
        try:
            r = self._session.post(url, timeout=self.timeout, **kwargs)
        except requests.RequestException as e:
            raise AuthError("lỗi mạng khi xác thực: %s" % e)
        try:
            body = r.json()
        except ValueError:
            body = {}
        if r.status_code != 200:
            msg = body.get("error", {}) if isinstance(body, dict) else {}
            if isinstance(msg, dict):
                msg = msg.get("message", r.text[:200])
            raise AuthError("HTTP %s: %s" % (r.status_code, msg))
        return body

    def _set(self, token, refresh, expires):
        try:
            ttl = float(expires)
        except (TypeError, ValueError):
            ttl = 3600.0
        self._token = token
        self._refresh = refresh or self._refresh
        self._ttl = max(30.0, ttl)
        self._exp_mono = time.monotonic() + self._ttl

    def _sign_in(self):
        body = self._post(
            "%s/accounts:signInWithPassword" % self.identity_url,
            params={"key": self.api_key},
            json={"email": self.email, "password": self.password, "returnSecureToken": True},
        )
        if not body.get("idToken"):
            raise AuthError("phản hồi đăng nhập thiếu idToken")
        self.uid = body.get("localId")
        self._set(body["idToken"], body.get("refreshToken"), body.get("expiresIn"))
        log.info("Đăng nhập Firebase Auth OK (%s, uid=%s)", self.email, self.uid)

    def _do_refresh(self):
        body = self._post(
            "%s/token" % self.securetoken_url,
            params={"key": self.api_key},
            data={"grant_type": "refresh_token", "refresh_token": self._refresh},
        )
        if not body.get("id_token"):
            raise AuthError("phản hồi refresh thiếu id_token")
        self._set(body["id_token"], body.get("refresh_token"), body.get("expires_in"))
        log.debug("Đã làm mới idToken")


class FirebaseClient(object):
    """GET/PUT/PATCH/POST tới `{db_url}/{path}.json`. Trả (http_status, body_json)."""

    def __init__(self, db_url, auth=None, timeout=15.0):
        self.db_url = (db_url or "").rstrip("/")
        self.auth = auth
        self.timeout = timeout
        self._local = threading.local()  # mỗi thread 1 requests.Session

    def _session(self):
        s = getattr(self._local, "session", None)
        if s is None:
            s = requests.Session()
            s.headers.update({"Content-Type": "application/json"})
            self._local.session = s
        return s

    def url(self, path):
        path = (path or "").strip("/")
        return "%s/%s.json" % (self.db_url, path) if path else "%s/.json" % self.db_url

    def request(self, method, path, body=None, timeout=None, params=None):
        if not self.db_url:
            raise requests.ConnectionError("chưa cấu hình firebase.db_url")
        data = None
        if body is not None:
            data = json.dumps(body, separators=(",", ":"), allow_nan=False)
        attempts = 2 if (self.auth is not None and self.auth.enabled) else 1
        status, parsed = None, None
        for attempt in range(attempts):
            q = dict(params or {})
            if self.auth is not None and self.auth.enabled:
                q["auth"] = self.auth.get_token()  # AuthError -> caller xử lý như lỗi mạng
            r = self._session().request(
                method, self.url(path), data=data, params=q, timeout=timeout or self.timeout
            )
            status = r.status_code
            try:
                parsed = r.json() if r.content else None
            except ValueError:
                parsed = r.text[:500]
            if status in (401, 403) and attempt + 1 < attempts:
                log.warning("Firebase trả %s -> đăng nhập lại và thử lại 1 lần", status)
                self.auth.invalidate()
                continue
            break
        return status, parsed

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def put(self, path, body, **kw):
        return self.request("PUT", path, body=body, **kw)

    def patch(self, path, body, **kw):
        return self.request("PATCH", path, body=body, **kw)

    def post(self, path, body, **kw):
        return self.request("POST", path, body=body, **kw)


def error_text(status, body):
    if isinstance(body, dict) and "error" in body:
        return "HTTP %s: %s" % (status, body.get("error"))
    if body:
        return "HTTP %s: %s" % (status, str(body)[:200])
    return "HTTP %s" % status
