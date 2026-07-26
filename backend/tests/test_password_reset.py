"""Password reset feature tests (owner -> room admin, admin -> room user)."""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

OWNER = ("xpertcctv.delhi@gmail.com", "love@2001")
BOB = ("bob.ops@example.com", "Bob@12345")
ALICE = ("alice.ops", "Alice@12345")


def login(identifier, password):
    return requests.post(f"{API}/auth/login", json={"identifier": identifier, "password": password}, timeout=30)


def token_of(identifier, password):
    r = login(identifier, password)
    assert r.status_code == 200, f"login failed for {identifier}: {r.status_code} {r.text[:300]}"
    t = r.json().get("token")
    assert t
    return t


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def owner_token():
    return token_of(*OWNER)


@pytest.fixture(scope="module")
def bob_room_id(owner_token):
    r = requests.get(f"{API}/platform/rooms", headers=hdr(owner_token), timeout=30)
    assert r.status_code == 200
    for room in r.json()["rooms"]:
        adm = room.get("admin") or {}
        if adm.get("email") == BOB[0]:
            return room["id"]
    pytest.fail("Bob's room not found")


@pytest.fixture(scope="module")
def alice_id():
    tok = token_of(*BOB)
    r = requests.get(f"{API}/admin/members", headers=hdr(tok), timeout=30)
    assert r.status_code == 200
    for m in r.json()["members"]:
        if m.get("username") == ALICE[0]:
            return m["id"]
    pytest.fail("Alice not found in Bob's room")


# --- Owner resets room admin password ---
class TestOwnerResetAdminPassword:
    def test_reset_and_login_with_new_password(self, owner_token, bob_room_id):
        new_pw = "BobTest@2026"
        r = requests.post(
            f"{API}/platform/rooms/{bob_room_id}/reset-admin-password",
            json={"new_password": new_pw}, headers=hdr(owner_token), timeout=30,
        )
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert data["ok"] is True
        assert BOB[0] in data["message"]

        # new password works
        assert login(BOB[0], new_pw).status_code == 200
        # old password rejected
        assert login(BOB[0], BOB[1]).status_code in (401, 403, 429)

        # restore
        rr = requests.post(
            f"{API}/platform/rooms/{bob_room_id}/reset-admin-password",
            json={"new_password": BOB[1]}, headers=hdr(owner_token), timeout=30,
        )
        assert rr.status_code == 200
        assert login(*BOB).status_code == 200

    def test_short_password_422(self, owner_token, bob_room_id):
        r = requests.post(
            f"{API}/platform/rooms/{bob_room_id}/reset-admin-password",
            json={"new_password": "abc"}, headers=hdr(owner_token), timeout=30,
        )
        assert r.status_code == 422

    def test_unknown_room_404(self, owner_token):
        r = requests.post(
            f"{API}/platform/rooms/does-not-exist/reset-admin-password",
            json={"new_password": "Whatever@123"}, headers=hdr(owner_token), timeout=30,
        )
        assert r.status_code == 404

    def test_no_auth_401(self, bob_room_id):
        r = requests.post(
            f"{API}/platform/rooms/{bob_room_id}/reset-admin-password",
            json={"new_password": "Whatever@123"}, timeout=30,
        )
        assert r.status_code in (401, 403)


# --- Room admin resets member password ---
class TestAdminResetMemberPassword:
    def test_reset_and_login(self, alice_id):
        tok = token_of(*BOB)
        new_pw = "AliceNew@123"
        r = requests.post(
            f"{API}/admin/members/{alice_id}/reset-password",
            json={"new_password": new_pw}, headers=hdr(tok), timeout=30,
        )
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert data["ok"] is True
        assert ALICE[0] in data["message"]
        assert login(ALICE[0], new_pw).status_code == 200
        assert login(*ALICE).status_code in (401, 403, 429)

        # restore
        rr = requests.post(
            f"{API}/admin/members/{alice_id}/reset-password",
            json={"new_password": ALICE[1]}, headers=hdr(tok), timeout=30,
        )
        assert rr.status_code == 200
        assert login(*ALICE).status_code == 200

    def test_short_password_422(self, alice_id):
        tok = token_of(*BOB)
        r = requests.post(
            f"{API}/admin/members/{alice_id}/reset-password",
            json={"new_password": "12345"}, headers=hdr(tok), timeout=30,
        )
        assert r.status_code == 422

    def test_unknown_member_404(self):
        tok = token_of(*BOB)
        r = requests.post(
            f"{API}/admin/members/nope-123/reset-password",
            json={"new_password": "Whatever@123"}, headers=hdr(tok), timeout=30,
        )
        assert r.status_code == 404


# --- Authorization matrix ---
class TestAuthorization:
    def test_user_cannot_reset_member(self, alice_id):
        tok = token_of(*ALICE)
        r = requests.post(
            f"{API}/admin/members/{alice_id}/reset-password",
            json={"new_password": "Hacker@123"}, headers=hdr(tok), timeout=30,
        )
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text[:200]}"

    def test_user_cannot_reset_room_admin(self, bob_room_id):
        tok = token_of(*ALICE)
        r = requests.post(
            f"{API}/platform/rooms/{bob_room_id}/reset-admin-password",
            json={"new_password": "Hacker@123"}, headers=hdr(tok), timeout=30,
        )
        assert r.status_code == 403

    def test_admin_cannot_reset_platform_admin_password(self, bob_room_id):
        tok = token_of(*BOB)
        r = requests.post(
            f"{API}/platform/rooms/{bob_room_id}/reset-admin-password",
            json={"new_password": "Hacker@123"}, headers=hdr(tok), timeout=30,
        )
        assert r.status_code == 403

    def test_admin_cannot_reset_member_of_other_room(self, owner_token, alice_id):
        """Create a 2nd room+admin, ensure that admin cannot reset Alice."""
        import uuid
        suffix = uuid.uuid4().hex[:8]
        email = f"TEST_admin_{suffix}@example.com"
        pw = "Second@12345"
        cr = requests.post(f"{API}/platform/rooms", json={
            "room_name": f"TEST_Room_{suffix}",
            "admin_name": "TEST Second Admin",
            "admin_email": email,
            "admin_password": pw,
        }, headers=hdr(owner_token), timeout=30)
        assert cr.status_code == 201, cr.text[:300]
        room_id = cr.json()["id"]
        try:
            tok2 = token_of(email, pw)
            r = requests.post(
                f"{API}/admin/members/{alice_id}/reset-password",
                json={"new_password": "Hacker@123"}, headers=hdr(tok2), timeout=30,
            )
            assert r.status_code == 404
            assert "Member not found in your room" in r.json().get("detail", "")
            # Alice's password unchanged
            assert login(*ALICE).status_code == 200
        finally:
            requests.delete(f"{API}/platform/rooms/{room_id}", headers=hdr(owner_token), timeout=30)


# --- Final state guard ---
def test_original_credentials_intact():
    assert login(*OWNER).status_code == 200
    assert login(*BOB).status_code == 200
    assert login(*ALICE).status_code == 200
