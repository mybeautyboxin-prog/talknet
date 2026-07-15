"""
TalkNet Iteration-3 backend tests (3-role model).
Covers: platform/rooms provision+list+patch+delete, /platform/stats, /platform/analytics,
old-endpoint removal, admin /admin/room + /admin/members CRUD + 15-cap,
/room/available, /room/token cross-tenant isolation, suspended-room enforcement.
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

SUFFIX = uuid.uuid4().hex[:8]


def _headers(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------------- fixtures ----------------
@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def room_a(owner_token):
    payload = {
        "room_name": f"tn3_RoomA_{SUFFIX}",
        "admin_name": "Admin A",
        "admin_email": f"tn3_admin_a_{SUFFIX}@example.com",
        "admin_password": "Admin@12345",
    }
    r = requests.post(f"{API}/platform/rooms", json=payload, headers=_headers(owner_token), timeout=15)
    assert r.status_code == 201, r.text
    data = r.json()
    yield {**data, "admin_email": payload["admin_email"], "admin_password": payload["admin_password"]}
    requests.delete(f"{API}/platform/rooms/{data['id']}", headers=_headers(owner_token), timeout=15)


@pytest.fixture(scope="module")
def room_b(owner_token):
    payload = {
        "room_name": f"tn3_RoomB_{SUFFIX}",
        "admin_name": "Admin B",
        "admin_email": f"tn3_admin_b_{SUFFIX}@example.com",
        "admin_password": "Admin@12345",
    }
    r = requests.post(f"{API}/platform/rooms", json=payload, headers=_headers(owner_token), timeout=15)
    assert r.status_code == 201, r.text
    data = r.json()
    yield {**data, "admin_email": payload["admin_email"], "admin_password": payload["admin_password"]}
    requests.delete(f"{API}/platform/rooms/{data['id']}", headers=_headers(owner_token), timeout=15)


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15)
    return r


@pytest.fixture(scope="module")
def admin_a_token(room_a):
    r = _login(room_a["admin_email"], room_a["admin_password"])
    assert r.status_code == 200
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_b_token(room_b):
    r = _login(room_b["admin_email"], room_b["admin_password"])
    assert r.status_code == 200
    return r.json()["token"]


# ---------------- auth / owner ----------------
def test_owner_login(owner_token):
    assert owner_token


def test_provision_room_shape(room_a):
    assert room_a["id"]
    assert room_a["admin_user_id"]
    assert room_a["admin"] is not None
    assert room_a["admin"]["email"] == room_a["admin_email"]
    assert room_a["admin"]["role"] == "room_admin"
    assert room_a["member_count"] == 0
    assert len(room_a["room_code"]) >= 4
    assert room_a["status"] == "active"


def test_duplicate_admin_email_409(owner_token, room_a):
    r = requests.post(
        f"{API}/platform/rooms",
        json={"room_name": "dup", "admin_name": "Dup", "admin_email": room_a["admin_email"], "admin_password": "Aaaa@1234"},
        headers=_headers(owner_token),
        timeout=15,
    )
    assert r.status_code == 409


def test_list_rooms(owner_token, room_a, room_b):
    r = requests.get(f"{API}/platform/rooms", headers=_headers(owner_token), timeout=15)
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()["rooms"]]
    assert room_a["id"] in ids and room_b["id"] in ids
    for room in r.json()["rooms"]:
        if room["id"] == room_a["id"]:
            assert room["admin"] is not None
            assert isinstance(room["member_count"], int)


def test_stats_shape(owner_token):
    r = requests.get(f"{API}/platform/stats", headers=_headers(owner_token), timeout=15)
    assert r.status_code == 200
    d = r.json()
    for k in ("total_rooms", "active_rooms", "total_admins", "total_users"):
        assert k in d


def test_analytics_top_rooms(owner_token):
    r = requests.get(f"{API}/platform/analytics", headers=_headers(owner_token), timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert "daily" in d and "top_rooms" in d


def test_old_customers_endpoint_gone(owner_token):
    r = requests.get(f"{API}/platform/customers", headers=_headers(owner_token), timeout=15)
    assert r.status_code == 404
    r2 = requests.get(f"{API}/admin/rooms", headers=_headers(owner_token), timeout=15)
    assert r2.status_code == 404


# ---------------- admin scope ----------------
def test_admin_get_my_room(admin_a_token, room_a):
    r = requests.get(f"{API}/admin/room", headers=_headers(admin_a_token), timeout=15)
    assert r.status_code == 200
    assert r.json()["id"] == room_a["id"]


def test_admin_add_member(admin_a_token, room_a):
    r = requests.post(
        f"{API}/admin/members",
        json={"name": "M1", "email": f"tn3_m1_{SUFFIX}@example.com", "password": "User@12345"},
        headers=_headers(admin_a_token),
        timeout=15,
    )
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["role"] == "user"
    assert m["room_id"] == room_a["id"]
    # verify list
    r2 = requests.get(f"{API}/admin/members", headers=_headers(admin_a_token), timeout=15)
    assert r2.status_code == 200
    ids = [x["id"] for x in r2.json()["members"]]
    assert m["id"] in ids
    pytest.member_a_id = m["id"]
    pytest.member_a_email = m["email"]


def test_admin_cannot_delete_other_room_member(admin_a_token, admin_b_token, room_b):
    # create member in B
    r = requests.post(
        f"{API}/admin/members",
        json={"name": "MB", "email": f"tn3_mb_{SUFFIX}@example.com", "password": "User@12345"},
        headers=_headers(admin_b_token),
        timeout=15,
    )
    assert r.status_code == 201
    mb_id = r.json()["id"]
    # admin A tries to delete
    r2 = requests.delete(f"{API}/admin/members/{mb_id}", headers=_headers(admin_a_token), timeout=15)
    assert r2.status_code == 404


def test_room_token_admin_own_room(admin_a_token, room_a):
    r = requests.post(f"{API}/room/token", json={"room_id": room_a["id"]}, headers=_headers(admin_a_token), timeout=15)
    # LiveKit is placeholder → may 500 or 200 depending on config; but access check runs first
    assert r.status_code in (200, 500)


def test_room_token_admin_cross_room_404(admin_a_token, room_b):
    r = requests.post(f"{API}/room/token", json={"room_id": room_b["id"]}, headers=_headers(admin_a_token), timeout=15)
    assert r.status_code == 404


def test_user_token_isolation(admin_a_token, room_a, room_b):
    # login as member A
    r = _login(pytest.member_a_email, "User@12345")
    assert r.status_code == 200
    utok = r.json()["token"]
    r2 = requests.post(f"{API}/room/token", json={"room_id": room_b["id"]}, headers=_headers(utok), timeout=15)
    assert r2.status_code == 404
    # own room OK (500 acceptable for placeholder LK)
    r3 = requests.post(f"{API}/room/token", json={"room_id": room_a["id"]}, headers=_headers(utok), timeout=15)
    assert r3.status_code in (200, 500)


def test_room_available_admin_and_user(admin_a_token, owner_token, room_a):
    r = requests.get(f"{API}/room/available", headers=_headers(admin_a_token), timeout=15)
    assert r.status_code == 200
    rooms = r.json()["rooms"]
    assert len(rooms) == 1 and rooms[0]["id"] == room_a["id"]
    # owner forbidden
    ro = requests.get(f"{API}/room/available", headers=_headers(owner_token), timeout=15)
    assert ro.status_code == 403
    # user
    ru = _login(pytest.member_a_email, "User@12345")
    utok = ru.json()["token"]
    r2 = requests.get(f"{API}/room/available", headers=_headers(utok), timeout=15)
    assert r2.status_code == 200
    assert len(r2.json()["rooms"]) == 1 and r2.json()["rooms"][0]["id"] == room_a["id"]


def test_suspend_cascades_and_blocks_token(owner_token, admin_a_token, room_a):
    r = requests.patch(f"{API}/platform/rooms/{room_a['id']}", json={"status": "suspended"}, headers=_headers(owner_token), timeout=15)
    assert r.status_code == 200
    assert r.json()["status"] == "suspended"
    # admin's protected endpoint should now 403 because admin's user.status became suspended
    ra = requests.get(f"{API}/auth/me", headers=_headers(admin_a_token), timeout=15)
    assert ra.status_code == 403
    # try user login and see suspension effect
    ru = _login(pytest.member_a_email, "User@12345")
    if ru.status_code == 200:
        utok = ru.json()["token"]
        rt = requests.post(f"{API}/room/token", json={"room_id": room_a["id"]}, headers=_headers(utok), timeout=15)
        assert rt.status_code == 403
    # restore
    rr = requests.patch(f"{API}/platform/rooms/{room_a['id']}", json={"status": "active"}, headers=_headers(owner_token), timeout=15)
    assert rr.status_code == 200


def test_15_cap(owner_token):
    # Provision fresh room for cap test
    p = requests.post(
        f"{API}/platform/rooms",
        json={"room_name": f"tn3_cap_{SUFFIX}", "admin_name": "Cap", "admin_email": f"tn3_cap_admin_{SUFFIX}@example.com", "admin_password": "Admin@12345"},
        headers=_headers(owner_token),
        timeout=15,
    )
    assert p.status_code == 201
    rid = p.json()["id"]
    # login as that admin
    tok = _login(f"tn3_cap_admin_{SUFFIX}@example.com", "Admin@12345").json()["token"]
    last_status = None
    for i in range(16):
        r = requests.post(
            f"{API}/admin/members",
            json={"name": f"m{i}", "email": f"tn3_cap_m{i}_{SUFFIX}@example.com", "password": "User@12345"},
            headers=_headers(tok),
            timeout=15,
        )
        last_status = r.status_code
        if i < 15:
            assert r.status_code == 201, f"member {i} failed: {r.text}"
    assert last_status == 400  # 16th
    # cleanup
    requests.delete(f"{API}/platform/rooms/{rid}", headers=_headers(owner_token), timeout=15)


def test_delete_room_cleans_users(owner_token):
    p = requests.post(
        f"{API}/platform/rooms",
        json={"room_name": f"tn3_del_{SUFFIX}", "admin_name": "Del", "admin_email": f"tn3_del_admin_{SUFFIX}@example.com", "admin_password": "Admin@12345"},
        headers=_headers(owner_token),
        timeout=15,
    )
    rid = p.json()["id"]
    adm_email = f"tn3_del_admin_{SUFFIX}@example.com"
    d = requests.delete(f"{API}/platform/rooms/{rid}", headers=_headers(owner_token), timeout=15)
    assert d.status_code == 204
    # admin cannot login anymore (user deleted)
    r = _login(adm_email, "Admin@12345")
    assert r.status_code == 401
