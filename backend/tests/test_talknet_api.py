"""
TalkNet backend API test suite.
Covers: health, auth (platform_owner + room_admin), platform CRUD, admin members,
room token, multi-tenant isolation, suspend cascade.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realtime-voice-hub-6.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "xpertcctv.delhi@gmail.com"
OWNER_PASSWORD = "love@2001"


# ---------- helpers ----------
def _login(email, password):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def owner_token():
    r = _login(OWNER_EMAIL, OWNER_PASSWORD)
    assert r.status_code == 200, f"owner login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def unique_suffix():
    return uuid.uuid4().hex[:8]


# session-scoped state used across tests
_state = {}


# ---------- health ----------
def test_health():
    r = requests.get(f"{API}/health", timeout=10)
    assert r.status_code == 200
    assert r.json()["status"] == "healthy"


# ---------- auth ----------
def test_login_owner_success():
    r = _login(OWNER_EMAIL, OWNER_PASSWORD)
    assert r.status_code == 200
    data = r.json()
    assert "token" in data and isinstance(data["token"], str)
    assert data["user"]["role"] == "platform_owner"
    assert data["user"]["email"] == OWNER_EMAIL


def test_login_invalid_password():
    r = _login(OWNER_EMAIL, "wrong-password")
    assert r.status_code == 401
    assert "Invalid" in r.json().get("detail", "")


def test_auth_me(owner_token):
    r = requests.get(f"{API}/auth/me", headers=_hdr(owner_token), timeout=10)
    assert r.status_code == 200
    assert r.json()["user"]["email"] == OWNER_EMAIL


def test_auth_me_no_token():
    r = requests.get(f"{API}/auth/me", timeout=10)
    assert r.status_code in (401, 403)


# ---------- platform stats ----------
def test_platform_stats(owner_token):
    r = requests.get(f"{API}/platform/stats", headers=_hdr(owner_token), timeout=10)
    assert r.status_code == 200
    d = r.json()
    for k in ("total_customers", "active_customers", "total_users", "total_admins"):
        assert k in d


# ---------- customer CRUD ----------
def test_create_customer_A(owner_token, unique_suffix):
    payload = {
        "customer_name": f"TEST_Acme_{unique_suffix}",
        "admin_name": "Acme Admin",
        "admin_email": f"test_admin_a_{unique_suffix}@acme.com",
        "admin_password": "Admin@12345",
        "room_name": "Acme Control Room",
    }
    r = requests.post(f"{API}/platform/customers", headers=_hdr(owner_token), json=payload, timeout=15)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["name"] == payload["customer_name"]
    assert d["admin"]["email"] == payload["admin_email"]
    assert d["admin"]["role"] == "room_admin"
    assert d["room"]["room_code"] and len(d["room"]["room_code"]) >= 4
    _state["customer_a"] = d
    _state["admin_a_email"] = payload["admin_email"]
    _state["admin_a_password"] = payload["admin_password"]


def test_create_customer_duplicate_email(owner_token):
    a = _state["customer_a"]
    payload = {
        "customer_name": a["name"] + "_dup",
        "admin_name": "Dup",
        "admin_email": _state["admin_a_email"],
        "admin_password": "Admin@12345",
        "room_name": "Dup Room",
    }
    r = requests.post(f"{API}/platform/customers", headers=_hdr(owner_token), json=payload, timeout=15)
    assert r.status_code == 409


def test_create_customer_B(owner_token, unique_suffix):
    payload = {
        "customer_name": f"TEST_Beta_{unique_suffix}",
        "admin_name": "Beta Admin",
        "admin_email": f"test_admin_b_{unique_suffix}@beta.com",
        "admin_password": "Admin@12345",
        "room_name": "Beta Control Room",
    }
    r = requests.post(f"{API}/platform/customers", headers=_hdr(owner_token), json=payload, timeout=15)
    assert r.status_code == 201, r.text
    _state["customer_b"] = r.json()
    _state["admin_b_email"] = payload["admin_email"]
    _state["admin_b_password"] = payload["admin_password"]


def test_list_customers(owner_token):
    r = requests.get(f"{API}/platform/customers", headers=_hdr(owner_token), timeout=15)
    assert r.status_code == 200
    ids = {c["id"] for c in r.json()["customers"]}
    assert _state["customer_a"]["id"] in ids
    assert _state["customer_b"]["id"] in ids


# ---------- room admin login + admin routes ----------
def test_admin_login_a():
    r = _login(_state["admin_a_email"], _state["admin_a_password"])
    assert r.status_code == 200
    d = r.json()
    assert d["user"]["role"] == "room_admin"
    _state["admin_a_token"] = d["token"]


def test_admin_login_b():
    r = _login(_state["admin_b_email"], _state["admin_b_password"])
    assert r.status_code == 200
    _state["admin_b_token"] = r.json()["token"]


def test_admin_get_room():
    r = requests.get(f"{API}/admin/room", headers=_hdr(_state["admin_a_token"]), timeout=10)
    assert r.status_code == 200
    assert r.json()["room_code"] == _state["customer_a"]["room"]["room_code"]


def test_admin_add_member(unique_suffix):
    r = requests.post(
        f"{API}/admin/members",
        headers=_hdr(_state["admin_a_token"]),
        json={
            "name": "Member One",
            "email": f"test_user1_{unique_suffix}@acme.com",
            "password": "User@12345",
        },
        timeout=10,
    )
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["role"] == "user"
    _state["member1_id"] = d["id"]

    # GET verify persistence
    lst = requests.get(f"{API}/admin/members", headers=_hdr(_state["admin_a_token"]), timeout=10).json()
    assert any(m["id"] == d["id"] for m in lst["members"])


def test_admin_member_isolation():
    # admin B cannot see admin A's members
    r = requests.get(f"{API}/admin/members", headers=_hdr(_state["admin_b_token"]), timeout=10)
    assert r.status_code == 200
    assert not any(m["id"] == _state["member1_id"] for m in r.json()["members"])

    # admin B cannot delete admin A's member
    r = requests.delete(
        f"{API}/admin/members/{_state['member1_id']}",
        headers=_hdr(_state["admin_b_token"]),
        timeout=10,
    )
    assert r.status_code == 404


def test_platform_owner_forbidden_on_admin_routes(owner_token):
    r = requests.get(f"{API}/admin/room", headers=_hdr(owner_token), timeout=10)
    assert r.status_code == 403


# ---------- room token ----------
def test_room_token_as_admin():
    r = requests.post(f"{API}/room/token", headers=_hdr(_state["admin_a_token"]), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["is_host"] is True
    assert d["token"] and d["livekit_url"] and d["room_name"] and d["identity"]


def test_room_token_as_owner_forbidden(owner_token):
    r = requests.post(f"{API}/room/token", headers=_hdr(owner_token), timeout=10)
    assert r.status_code == 403


# ---------- 15-cap enforcement ----------
def test_member_cap_15(unique_suffix, owner_token):
    # customer A currently has 1 member. Add 14 more -> total 15, then 16th should 400.
    token = _state["admin_a_token"]
    for i in range(2, 16):
        r = requests.post(
            f"{API}/admin/members",
            headers=_hdr(token),
            json={
                "name": f"Member {i}",
                "email": f"test_user{i}_{unique_suffix}@acme.com",
                "password": "User@12345",
            },
            timeout=10,
        )
        assert r.status_code == 201, f"member {i} failed: {r.status_code} {r.text}"
    # 16th
    r = requests.post(
        f"{API}/admin/members",
        headers=_hdr(token),
        json={
            "name": "Member 16",
            "email": f"test_user16_{unique_suffix}@acme.com",
            "password": "User@12345",
        },
        timeout=10,
    )
    assert r.status_code == 400
    assert "limit" in r.json().get("detail", "").lower()


# ---------- suspend cascade ----------
def test_suspend_customer_b_and_login_blocked(owner_token):
    cid = _state["customer_b"]["id"]
    r = requests.patch(
        f"{API}/platform/customers/{cid}",
        headers=_hdr(owner_token),
        json={"status": "suspended"},
        timeout=10,
    )
    assert r.status_code == 200
    assert r.json()["status"] == "suspended"

    # admin B login should now be blocked
    r = _login(_state["admin_b_email"], _state["admin_b_password"])
    assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"


# ---------- delete customer cleanup ----------
def test_delete_customer_a(owner_token):
    cid = _state["customer_a"]["id"]
    r = requests.delete(f"{API}/platform/customers/{cid}", headers=_hdr(owner_token), timeout=15)
    assert r.status_code == 204

    # admin A login should now fail (user deleted)
    r = _login(_state["admin_a_email"], _state["admin_a_password"])
    assert r.status_code == 401


def test_delete_customer_b_cleanup(owner_token):
    cid = _state["customer_b"]["id"]
    r = requests.delete(f"{API}/platform/customers/{cid}", headers=_hdr(owner_token), timeout=15)
    assert r.status_code == 204
