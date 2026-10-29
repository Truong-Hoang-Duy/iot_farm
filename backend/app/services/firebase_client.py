"""Firebase Realtime Database REST client (async, httpx) có xác thực.

Thứ tự ưu tiên xác thực:
1. Service Account JSON (FIREBASE_SERVICE_ACCOUNT) -> OAuth2 access_token (quyền Admin, bỏ qua Rules).
2. Firebase Auth email/password (FIREBASE_API_KEY + FIREBASE_AUTH_EMAIL + FIREBASE_AUTH_PASSWORD) -> idToken.
3. Không xác thực (chỉ chạy được khi Rules đang mở).
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import httpx

from app.core.config import (
    BASE_DIR,
    FIREBASE_API_KEY,
    FIREBASE_AUTH_EMAIL,
    FIREBASE_AUTH_PASSWORD,
    FIREBASE_DB_URL,
    FIREBASE_SERVICE_ACCOUNT,
)

SCOPES = [
    "https://www.googleapis.com/auth/firebase.database",
    "https://www.googleapis.com/auth/userinfo.email",
]


class FirebaseError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


class FirebaseRTDB:
    def __init__(self, db_url: str = FIREBASE_DB_URL):
        self.db_url = db_url.rstrip("/")
        self._token: Optional[str] = None
        self._token_exp: float = 0.0
        self._refresh_token: Optional[str] = None
        self._lock = asyncio.Lock()
        self._sa_creds = None
        sa_path = Path(FIREBASE_SERVICE_ACCOUNT) if FIREBASE_SERVICE_ACCOUNT else None
        if sa_path is not None and not sa_path.is_absolute():
            sa_path = BASE_DIR / sa_path
        self.sa_path = sa_path if sa_path is not None and sa_path.exists() else None
        if self.sa_path is not None:
            self.auth_mode = "service_account"
        elif FIREBASE_API_KEY and FIREBASE_AUTH_EMAIL and FIREBASE_AUTH_PASSWORD:
            self.auth_mode = "email_password"
        else:
            self.auth_mode = "none"

    # ------------------------------------------------------------------ auth
    def _sa_token_sync(self) -> tuple[str, float]:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account

        if self._sa_creds is None:
            self._sa_creds = service_account.Credentials.from_service_account_file(
                str(self.sa_path), scopes=SCOPES
            )
        self._sa_creds.refresh(Request())
        exp = self._sa_creds.expiry.timestamp() if self._sa_creds.expiry else time.time() + 3000
        return self._sa_creds.token, exp

    async def _email_token(self, client: httpx.AsyncClient) -> tuple[str, float]:
        if self._refresh_token:
            r = await client.post(
                f"https://securetoken.googleapis.com/v1/token?key={FIREBASE_API_KEY}",
                data={"grant_type": "refresh_token", "refresh_token": self._refresh_token},
            )
            if r.status_code == 200:
                d = r.json()
                self._refresh_token = d.get("refresh_token", self._refresh_token)
                return d["id_token"], time.time() + int(d.get("expires_in", 3600))
        r = await client.post(
            f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_API_KEY}",
            json={"email": FIREBASE_AUTH_EMAIL, "password": FIREBASE_AUTH_PASSWORD, "returnSecureToken": True},
        )
        if r.status_code != 200:
            raise FirebaseError(r.status_code, f"Đăng nhập Firebase Auth thất bại: {r.text[:200]}")
        d = r.json()
        self._refresh_token = d.get("refreshToken")
        return d["idToken"], time.time() + int(d.get("expiresIn", 3600))

    async def _auth_params(self, client: httpx.AsyncClient, force: bool = False) -> Dict[str, str]:
        if self.auth_mode == "none":
            return {}
        async with self._lock:
            if force or not self._token or time.time() > self._token_exp - 120:
                if self.auth_mode == "service_account":
                    self._token, self._token_exp = await asyncio.to_thread(self._sa_token_sync)
                else:
                    self._token, self._token_exp = await self._email_token(client)
        key = "access_token" if self.auth_mode == "service_account" else "auth"
        return {key: self._token or ""}

    # --------------------------------------------------------------- request
    def _url(self, path: str) -> str:
        path = path.strip("/")
        enc = "/".join(quote(p, safe="") for p in path.split("/")) if path else ""
        return f"{self.db_url}/{enc}.json"

    async def request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        body: Any = None,
        timeout: float = 30.0,
    ) -> Any:
        params = dict(params or {})
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=10.0)) as client:
            for attempt in range(2):
                auth = await self._auth_params(client, force=attempt > 0)
                r = await client.request(
                    method,
                    self._url(path),
                    params={**params, **auth},
                    content=None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8"),
                    headers={"Content-Type": "application/json"} if body is not None else None,
                )
                if r.status_code == 401 and attempt == 0 and self.auth_mode != "none":
                    continue
                if r.status_code >= 400:
                    raise FirebaseError(r.status_code, r.text[:300])
                return r.json() if r.content else None
        return None

    async def get(self, path: str, **params: Any) -> Any:
        return await self.request("GET", path, params=params)

    async def put(self, path: str, value: Any) -> Any:
        return await self.request("PUT", path, body=value)

    async def patch(self, path: str, value: Dict[str, Any]) -> Any:
        return await self.request("PATCH", path, body=value)

    async def post(self, path: str, value: Any) -> Any:
        return await self.request("POST", path, body=value)

    async def shallow_keys(self, path: str) -> List[str]:
        data = await self.request("GET", path, params={"shallow": "true"})
        return sorted(data.keys()) if isinstance(data, dict) else []

    async def query_by_key(
        self, path: str, start_at: Optional[str] = None, end_at: Optional[str] = None,
        limit_to_last: Optional[int] = None,
    ) -> Any:
        params: Dict[str, Any] = {"orderBy": '"$key"'}
        if start_at is not None:
            params["startAt"] = json.dumps(start_at)
        if end_at is not None:
            params["endAt"] = json.dumps(end_at)
        if limit_to_last is not None:
            params["limitToLast"] = int(limit_to_last)
        return await self.request("GET", path, params=params, timeout=120.0)

    def info(self) -> Dict[str, Any]:
        return {
            "db_url": self.db_url,
            "auth_mode": self.auth_mode,
            "service_account_file": str(self.sa_path) if self.sa_path else None,
        }


_client: Optional[FirebaseRTDB] = None


def get_firebase() -> FirebaseRTDB:
    global _client
    if _client is None:
        _client = FirebaseRTDB()
    return _client


SERVER_TIMESTAMP = {".sv": "timestamp"}

