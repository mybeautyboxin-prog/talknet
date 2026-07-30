"""Regression: POST /api/admin/members validation + cleanup of UI-created test users."""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

ADMIN = {"identifier": "bob.ops@example.com", "password": "Bob@12345"}
USER = {"identifier": "alice.ops", "password": "Alice@12345"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"login failed {r.status_code}: {r.text[:300]}")
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def user_token():
    return _login(USER)


class TestMemberCreateValidation:
    def test_duplicate_username_409(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/members",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"name": "TEST_Dup", "username": "alice.ops", "password": "Pass@1234"},
            timeout=30,
        )
        assert r.status_code == 409, r.text
        assert "already in use" in r.text.lower()

    def test_invalid_username_422(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/members",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"name": "TEST_Bad", "username": "bad user!!", "password": "Pass@1234"},
            timeout=30,
        )
        assert r.status_code == 422, r.text

    def test_non_admin_403(self, user_token):
        r = requests.post(
            f"{BASE_URL}/api/admin/members",
            headers={"Authorization": f"Bearer {user_token}"},
            json={"name": "TEST_NoPerm", "username": "test_noperm_x", "password": "Pass@1234"},
            timeout=30,
        )
        assert r.status_code == 403, r.text


class TestCleanupUiCreatedUsers:
    def test_delete_ui_test_users_and_verify(self, admin_token):
        h = {"Authorization": f"Bearer {admin_token}"}
        r = requests.get(f"{BASE_URL}/api/admin/members", headers=h, timeout=30)
        assert r.status_code == 200
        members = r.json()["members"]
        targets = [m for m in members if (m.get("username") or "").startswith(("ui_alpha_", "ui_beta_", "ui_gamma_", "TEST_"))]
        for m in targets:
            d = requests.delete(f"{BASE_URL}/api/admin/members/{m['id']}", headers=h, timeout=30)
            assert d.status_code in (200, 204), d.text
        # verify removal + seeded users intact
        r2 = requests.get(f"{BASE_URL}/api/admin/members", headers=h, timeout=30)
        assert r2.status_code == 200
        remaining = [m.get("username") for m in r2.json()["members"]]
        assert not [u for u in remaining if u and u.startswith(("ui_alpha_", "ui_beta_", "ui_gamma_"))]
        assert "alice.ops" in remaining
        assert "charlie" in remaining
        # no mongo _id leakage
        assert all("_id" not in m for m in r2.json()["members"])
