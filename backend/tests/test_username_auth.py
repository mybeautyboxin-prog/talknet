"""
TalkNet Iteration-5 backend tests: USERNAME-BASED user login + username-only admin/members endpoint.

Covers:
- POST /api/auth/login with `identifier` field
  - Owner login via email
  - Admin login via email
  - User login via username (no @)
  - Wrong password → 401 with distinct email vs username error messages
  - Old {"email": ...} payload rejected (identifier required)
- POST /api/admin/members with {name, username, password} (no email)
  - Success: email=None, username set
  - Duplicate username → 409
  - Invalid chars (space, @) → 422
- New user can log in immediately via username.
- Plan cards: A=10 (PTT), B=15 (PTT), C=25 always-muted via /api/platform/plans.
"""
import os
import uuid
import pytest
import requests


def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    envp = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", ".env")
    with open(envp) as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not found")


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

OWNER_EMAIL = "xpertcctv.delhi@gmail.com"
OWNER_PASSWORD = "love@2001"
ADMIN_EMAIL = "bob.ops@example.com"
ADMIN_PASSWORD = "Bob@12345"
ALICE_USERNAME = "alice.ops"
ALICE_PASSWORD = "Alice@12345"

SUFFIX = uuid.uuid4().hex[:6]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _login(identifier, password):
    return requests.post(
        f"{API}/auth/login",
        json={"identifier": identifier, "password": password},
        timeout=15,
    )


# ---------- Auth: identifier field ----------
def test_owner_login_via_email_identifier():
    r = _login(OWNER_EMAIL, OWNER_PASSWORD)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data and data["token"]
    assert data["user"]["role"] == "platform_owner"
    assert data["user"]["email"] == OWNER_EMAIL


def test_admin_login_via_email_identifier():
    r = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["role"] == "room_admin"
    assert d["user"]["email"] == ADMIN_EMAIL


def test_user_login_via_username_identifier():
    r = _login(ALICE_USERNAME, ALICE_PASSWORD)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["role"] == "user"
    assert d["user"]["username"] == ALICE_USERNAME
    assert "token" in d and d["token"]


def test_old_email_field_rejected():
    # The endpoint now demands `identifier`; old `email` key should 422.
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=15)
    assert r.status_code == 422


def test_wrong_email_password_says_email():
    r = _login(OWNER_EMAIL, "wrongpw_" + SUFFIX)
    assert r.status_code == 401
    assert "email" in r.json()["detail"].lower()


def test_wrong_username_password_says_username():
    r = _login(ALICE_USERNAME, "wrongpw_" + SUFFIX)
    assert r.status_code == 401
    assert "username" in r.json()["detail"].lower()


# ---------- Admin: create member via username ----------
@pytest.fixture(scope="module")
def admin_token():
    r = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def new_user_username():
    return f"tuser_{SUFFIX}"


def test_admin_create_member_username_only(admin_token, new_user_username):
    r = requests.post(
        f"{API}/admin/members",
        json={"name": "TEST Temp User", "username": new_user_username, "password": "Test@1234"},
        headers=_hdr(admin_token),
        timeout=15,
    )
    assert r.status_code == 201, r.text
    u = r.json()
    assert u["username"] == new_user_username
    assert u.get("email") in (None, "")
    assert u["role"] == "user"


def test_new_user_can_login_via_username(new_user_username):
    r = _login(new_user_username, "Test@1234")
    assert r.status_code == 200, r.text
    assert r.json()["user"]["username"] == new_user_username


def test_duplicate_username_409(admin_token, new_user_username):
    r = requests.post(
        f"{API}/admin/members",
        json={"name": "Dup", "username": new_user_username, "password": "Test@1234"},
        headers=_hdr(admin_token),
        timeout=15,
    )
    assert r.status_code == 409
    assert "username" in r.json()["detail"].lower()


def test_invalid_username_chars_rejected(admin_token):
    for bad in ["has space", "hasat@x", "has#hash", "sh"]:
        r = requests.post(
            f"{API}/admin/members",
            json={"name": "Bad", "username": bad, "password": "Test@1234"},
            headers=_hdr(admin_token),
            timeout=15,
        )
        assert r.status_code == 422, f"expected 422 for '{bad}', got {r.status_code}: {r.text}"


def test_admin_members_list_has_username_no_email_required(admin_token, new_user_username):
    r = requests.get(f"{API}/admin/members", headers=_hdr(admin_token), timeout=15)
    assert r.status_code == 200
    members = r.json()["members"]
    usernames = [m.get("username") for m in members]
    assert new_user_username in usernames


# ---------- Plans ----------
def test_plans_shape():
    r = _login(OWNER_EMAIL, OWNER_PASSWORD)
    tok = r.json()["token"]
    r2 = requests.get(f"{API}/platform/plans", headers=_hdr(tok), timeout=15)
    assert r2.status_code == 200, r2.text
    plans = r2.json()
    # Response may be {"plans":[...]} or list
    if isinstance(plans, dict):
        plans = plans.get("plans", plans)
    by_code = {p["code"]: p for p in plans}
    assert by_code["A"]["max_users"] == 10 and by_code["A"]["listener_only"] is False
    assert by_code["B"]["max_users"] == 15 and by_code["B"]["listener_only"] is False
    assert by_code["C"]["max_users"] == 25 and by_code["C"]["listener_only"] is True


# ---------- Cleanup ----------
def test_zz_cleanup(admin_token, new_user_username):
    # find the new user's id and delete via admin
    r = requests.get(f"{API}/admin/members", headers=_hdr(admin_token), timeout=15)
    for m in r.json().get("members", []):
        if m.get("username") == new_user_username:
            requests.delete(f"{API}/admin/members/{m['id']}", headers=_hdr(admin_token), timeout=15)
            break
