"""
TalkNet iteration-2 backend test suite.
Covers: brute-force lockout, suspend runtime enforcement, password reset,
multi-room CRUD + last-room protection, /room/available, /room/token body,
session analytics, platform analytics.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://realtime-voice-hub-6.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "xpertcctv.delhi@gmail.com"
OWNER_PASSWORD = "love@2001"


def _login(email, password):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def owner_token():
    r = _login(OWNER_EMAIL, OWNER_PASSWORD)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def suffix():
    return uuid.uuid4().hex[:8]


@pytest.fixture(scope="module")
def customer_a(owner_token, suffix):
    payload = {
        "customer_name": f"TEST_V2_A_{suffix}",
        "admin_name": "V2 Admin A",
        "admin_email": f"test_v2_admin_a_{suffix}@acme.com",
        "admin_password": "Admin@12345",
        "room_name": "Primary Room",
    }
    r = requests.post(f"{API}/platform/customers", headers=_hdr(owner_token), json=payload, timeout=15)
    assert r.status_code == 201, r.text
    d = r.json()
    d["_admin_email"] = payload["admin_email"]
    d["_admin_password"] = payload["admin_password"]
    yield d
    # teardown
    requests.delete(f"{API}/platform/customers/{d['id']}", headers=_hdr(owner_token), timeout=15)


@pytest.fixture(scope="module")
def admin_a_token(customer_a):
    r = _login(customer_a["_admin_email"], customer_a["_admin_password"])
    assert r.status_code == 200, r.text
    return r.json()["token"]


# ============ Owner login smoke ============
def test_owner_login_still_works():
    r = _login(OWNER_EMAIL, OWNER_PASSWORD)
    assert r.status_code == 200
    d = r.json()
    assert "token" in d and d["user"]["role"] == "platform_owner"


# ============ Brute force lockout ============
def test_brute_force_lockout_on_6th_attempt(suffix):
    # unique non-existing email → guaranteed fail, ip:email identifier unique
    email = f"brute_{suffix}_{uuid.uuid4().hex[:6]}@acme.com"
    for i in range(5):
        r = _login(email, "wrong")
        assert r.status_code == 401, f"attempt {i+1}: {r.status_code} {r.text}"
    # 6th attempt should be locked
    r = _login(email, "wrong")
    assert r.status_code == 429, f"expected 429, got {r.status_code} {r.text}"
    assert "too many" in r.json().get("detail", "").lower() or "locked" in r.json().get("detail", "").lower()


def test_brute_force_counter_clears_on_success(customer_a):
    # 3 fails then a success → counter cleared → next fail should NOT lock
    email = customer_a["_admin_email"]
    pw = customer_a["_admin_password"]
    for i in range(3):
        r = _login(email, "wrong")
        assert r.status_code == 401
    # success clears
    r = _login(email, pw)
    assert r.status_code == 200
    # 1 more fail should still return 401 not 429
    r = _login(email, "wrong")
    assert r.status_code == 401, f"expected 401 (counter cleared), got {r.status_code}"


# ============ Suspended user runtime enforcement ============
def test_suspended_user_runtime_enforcement(owner_token, suffix):
    # Create fresh customer to avoid contaminating customer_a
    payload = {
        "customer_name": f"TEST_V2_Susp_{suffix}",
        "admin_name": "Susp Admin",
        "admin_email": f"test_v2_susp_{suffix}@acme.com",
        "admin_password": "Admin@12345",
        "room_name": "Susp Room",
    }
    r = requests.post(f"{API}/platform/customers", headers=_hdr(owner_token), json=payload, timeout=15)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    try:
        r = _login(payload["admin_email"], payload["admin_password"])
        assert r.status_code == 200
        admin_token = r.json()["token"]

        # verify works pre-suspend
        r = requests.get(f"{API}/auth/me", headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 200

        # suspend
        r = requests.patch(
            f"{API}/platform/customers/{cid}",
            headers=_hdr(owner_token),
            json={"status": "suspended"},
            timeout=10,
        )
        assert r.status_code == 200

        # existing token now blocked
        r = requests.get(f"{API}/auth/me", headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 403, f"expected 403, got {r.status_code}"
        r = requests.get(f"{API}/admin/rooms", headers=_hdr(admin_token), timeout=10)
        assert r.status_code == 403
    finally:
        requests.delete(f"{API}/platform/customers/{cid}", headers=_hdr(owner_token), timeout=15)


# ============ Password reset ============
def test_password_reset_flow(owner_token, suffix):
    # Create a fresh customer + admin
    payload = {
        "customer_name": f"TEST_V2_Reset_{suffix}",
        "admin_name": "Reset Admin",
        "admin_email": f"test_v2_reset_{suffix}@acme.com",
        "admin_password": "Original@123",
        "room_name": "Reset Room",
    }
    r = requests.post(f"{API}/platform/customers", headers=_hdr(owner_token), json=payload, timeout=15)
    assert r.status_code == 201
    cid = r.json()["id"]
    try:
        # request reset
        r = requests.post(f"{API}/auth/forgot-password", json={"email": payload["admin_email"]}, timeout=10)
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # Extract this user's reset token from backend log — scan for the
        # target email marker and pull the following Token line (last match).
        import re, subprocess, time as _t
        _t.sleep(0.5)
        combined = ""
        for path in ("/var/log/supervisor/backend.err.log", "/var/log/supervisor/backend.out.log"):
            try:
                combined += subprocess.run(
                    ["tail", "-n", "500", path], capture_output=True, text=True, timeout=5
                ).stdout
            except Exception:
                pass
        pat = re.compile(
            rf"PASSWORD RESET REQUESTED for {re.escape(payload['admin_email'])}.*?Token:\s*([A-Za-z0-9_\-]{{20,}})",
            re.DOTALL,
        )
        matches = pat.findall(combined)
        assert matches, "reset token for this user not found in backend logs"
        token = matches[-1]

        # reset with token
        new_pw = "NewPass@456"
        r = requests.post(f"{API}/auth/reset-password", json={"token": token, "new_password": new_pw}, timeout=10)
        assert r.status_code == 200, r.text

        # login with new password (from a unique perspective; but ip:email may be counter — should be cleared or 401 not lock)
        r = _login(payload["admin_email"], new_pw)
        assert r.status_code == 200, r.text

        # reuse same token → should fail
        r = requests.post(f"{API}/auth/reset-password", json={"token": token, "new_password": "Another@789"}, timeout=10)
        assert r.status_code == 400
    finally:
        requests.delete(f"{API}/platform/customers/{cid}", headers=_hdr(owner_token), timeout=15)


def test_forgot_password_unknown_email_still_200():
    r = requests.post(f"{API}/auth/forgot-password", json={"email": "nobody-xyz-123@nowhere.com"}, timeout=10)
    assert r.status_code == 200
    assert r.json().get("ok") is True


# ============ Multi-room ============
def test_admin_sees_one_room_initially(admin_a_token):
    r = requests.get(f"{API}/admin/rooms", headers=_hdr(admin_a_token), timeout=10)
    assert r.status_code == 200
    rooms = r.json()["rooms"]
    assert len(rooms) == 1


def test_admin_create_additional_room(admin_a_token):
    r = requests.post(f"{API}/admin/rooms", headers=_hdr(admin_a_token), json={"name": "Standup"}, timeout=10)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["name"] == "Standup"
    assert d["room_code"] and len(d["room_code"]) >= 4

    r = requests.get(f"{API}/admin/rooms", headers=_hdr(admin_a_token), timeout=10)
    assert r.status_code == 200
    assert len(r.json()["rooms"]) == 2


def test_cannot_delete_last_room(owner_token, suffix):
    payload = {
        "customer_name": f"TEST_V2_LastRoom_{suffix}",
        "admin_name": "LR Admin",
        "admin_email": f"test_v2_lastroom_{suffix}@acme.com",
        "admin_password": "Admin@12345",
        "room_name": "Only Room",
    }
    r = requests.post(f"{API}/platform/customers", headers=_hdr(owner_token), json=payload, timeout=15)
    assert r.status_code == 201
    cid = r.json()["id"]
    try:
        r = _login(payload["admin_email"], payload["admin_password"])
        atok = r.json()["token"]

        rooms = requests.get(f"{API}/admin/rooms", headers=_hdr(atok), timeout=10).json()["rooms"]
        assert len(rooms) == 1
        rid = rooms[0]["id"]
        r = requests.delete(f"{API}/admin/rooms/{rid}", headers=_hdr(atok), timeout=10)
        assert r.status_code == 400, f"expected 400 last-room, got {r.status_code}"

        # now create second and delete first
        requests.post(f"{API}/admin/rooms", headers=_hdr(atok), json={"name": "Second"}, timeout=10)
        r = requests.delete(f"{API}/admin/rooms/{rid}", headers=_hdr(atok), timeout=10)
        assert r.status_code == 204
    finally:
        requests.delete(f"{API}/platform/customers/{cid}", headers=_hdr(owner_token), timeout=15)


def test_room_cap_code_check():
    """Verify 20-room cap is coded in admin_routes.py (avoids creating 20 rooms)."""
    with open("/app/backend/routes/admin_routes.py") as f:
        src = f.read()
    assert "count >= 20" in src or ">= 20" in src, "room cap constant not found"
    assert "Room limit reached" in src


# ============ /room/available ============
def test_room_available_admin(admin_a_token):
    r = requests.get(f"{API}/room/available", headers=_hdr(admin_a_token), timeout=10)
    assert r.status_code == 200
    assert len(r.json()["rooms"]) >= 1


def test_room_available_owner_forbidden(owner_token):
    r = requests.get(f"{API}/room/available", headers=_hdr(owner_token), timeout=10)
    assert r.status_code == 403


def test_room_available_user(admin_a_token, customer_a, suffix):
    # add a user and verify GET /room/available returns rooms
    email = f"test_v2_user_{suffix}_{uuid.uuid4().hex[:4]}@acme.com"
    r = requests.post(
        f"{API}/admin/members",
        headers=_hdr(admin_a_token),
        json={"name": "V2 User", "email": email, "password": "User@12345"},
        timeout=10,
    )
    assert r.status_code == 201
    utok = _login(email, "User@12345").json()["token"]
    r = requests.get(f"{API}/room/available", headers=_hdr(utok), timeout=10)
    assert r.status_code == 200
    assert len(r.json()["rooms"]) >= 1


# ============ /room/token with body ============
def test_room_token_requires_body(admin_a_token):
    r = requests.post(f"{API}/room/token", headers=_hdr(admin_a_token), json={}, timeout=10)
    assert r.status_code == 422


def test_room_token_with_valid_room(admin_a_token):
    rooms = requests.get(f"{API}/admin/rooms", headers=_hdr(admin_a_token), timeout=10).json()["rooms"]
    rid = rooms[0]["id"]
    r = requests.post(f"{API}/room/token", headers=_hdr(admin_a_token), json={"room_id": rid}, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["is_host"] is True and d["token"] and d["identity"]


def test_room_token_cross_tenant_404(owner_token, admin_a_token, suffix):
    # Create customer B, get their room id, try with admin A token
    payload = {
        "customer_name": f"TEST_V2_B_{suffix}",
        "admin_name": "B Admin",
        "admin_email": f"test_v2_b_{suffix}_{uuid.uuid4().hex[:4]}@acme.com",
        "admin_password": "Admin@12345",
        "room_name": "B Room",
    }
    r = requests.post(f"{API}/platform/customers", headers=_hdr(owner_token), json=payload, timeout=15)
    assert r.status_code == 201
    cid_b = r.json()["id"]
    b_room_id = r.json()["default_room"]["id"]
    try:
        r = requests.post(f"{API}/room/token", headers=_hdr(admin_a_token), json={"room_id": b_room_id}, timeout=10)
        assert r.status_code == 404
    finally:
        requests.delete(f"{API}/platform/customers/{cid_b}", headers=_hdr(owner_token), timeout=15)


# ============ Session analytics ============
def test_session_start_end_and_analytics(admin_a_token, owner_token):
    rooms = requests.get(f"{API}/admin/rooms", headers=_hdr(admin_a_token), timeout=10).json()["rooms"]
    rid = rooms[0]["id"]
    r = requests.post(f"{API}/room/session/start", headers=_hdr(admin_a_token), json={"room_id": rid}, timeout=10)
    assert r.status_code == 200, r.text
    sid = r.json()["session_id"]
    time.sleep(1)
    r = requests.post(f"{API}/room/session/end", headers=_hdr(admin_a_token), json={"session_id": sid}, timeout=10)
    assert r.status_code == 200
    assert r.json()["duration_sec"] >= 0

    # platform analytics
    r = requests.get(f"{API}/platform/analytics", headers=_hdr(owner_token), timeout=15)
    assert r.status_code == 200
    d = r.json()
    for k in ("daily", "top_customers", "total_sessions", "total_minutes"):
        assert k in d
    assert d["total_sessions"] >= 1


def test_platform_stats_has_total_rooms(owner_token):
    r = requests.get(f"{API}/platform/stats", headers=_hdr(owner_token), timeout=10)
    assert r.status_code == 200
    assert "total_rooms" in r.json()
