"""Iteration 7 quick regression: auth login + /api/auth/me for all 3 roles (backend must be unchanged)."""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

ACCOUNTS = [
    ("xpertcctv.delhi@gmail.com", "love@2001", "platform_owner"),
    ("bob.ops@example.com", "Bob@12345", "room_admin"),
    ("alice.ops", "Alice@12345", "user"),
]


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.mark.parametrize("identifier,password,role", ACCOUNTS)
def test_login_and_me(client, identifier, password, role):
    r = client.post(f"{BASE_URL}/api/auth/login", json={"identifier": identifier, "password": password})
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert "token" in data and isinstance(data["token"], str) and data["token"]
    assert data["user"]["role"] == role
    me = client.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {data['token']}"})
    assert me.status_code == 200, me.text[:300]
    body = me.json()
    user = body.get("user", body)
    assert user["role"] == role
    assert "_id" not in user


def test_login_bad_password(client):
    r = client.post(f"{BASE_URL}/api/auth/login", json={"identifier": "alice.ops", "password": "wrong-pass-xyz"})
    assert r.status_code in (400, 401, 423, 429), r.text[:200]


def test_forgot_password_endpoint(client):
    r = client.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": "bob.ops@example.com"})
    assert r.status_code in (200, 202), r.text[:300]


def test_reset_password_invalid_token(client):
    r = client.post(f"{BASE_URL}/api/auth/reset-password", json={"token": "invalid-token-xyz", "new_password": "Abcd@12345"})
    assert r.status_code in (400, 401, 404, 422), r.text[:200]


def test_room_info_requires_auth(client):
    r = requests.get(f"{BASE_URL}/api/room/info/some-room")
    assert r.status_code in (401, 403), r.text[:200]
