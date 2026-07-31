"""Iteration 14 helper + backend regression for /api/admin/members (no backend changes expected).

Running this module as a script seeds N dummy users and writes their LiveKit tokens to
/tmp/layout_tokens.json for the Playwright layout test; `--cleanup` removes them.
"""
import json
import os
import sys

import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")

ADMIN = {"identifier": "bob.ops@example.com", "password": "Bob@12345"}
PREFIX = "layout_test_"
TOKENS_FILE = "/tmp/layout_tokens.json"


def login(identifier, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"identifier": identifier, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {identifier} -> {r.status_code} {r.text[:200]}"
    return r.json()


def admin_session():
    data = login(**ADMIN)
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {data['token']}", "Content-Type": "application/json"})
    return s, data["user"]["room_id"]


# ── backend regression: members POST / GET / DELETE ──
def test_members_crud_regression():
    s, room_id = admin_session()

    listed = s.get(f"{BASE_URL}/api/admin/members", timeout=30)
    assert listed.status_code == 200
    assert isinstance(listed.json()["members"], list)

    created = s.post(f"{BASE_URL}/api/admin/members",
                     json={"name": "TEST_Regression User", "username": "test_regression_u1", "password": "Regr@12345"},
                     timeout=30)
    assert created.status_code in (200, 201), created.text[:300]
    body = created.json()
    member = body.get("member", body)
    uid = member["id"]
    assert member["username"] == "test_regression_u1"
    assert member["name"] == "TEST_Regression User"
    assert member["role"] == "user"
    assert member["room_id"] == room_id
    assert "_id" not in member  # raw mongo ObjectId must not leak

    after = s.get(f"{BASE_URL}/api/admin/members", timeout=30).json()["members"]
    assert any(m["id"] == uid for m in after), "created member not persisted"

    # the new member can log in with username+password
    assert login("test_regression_u1", "Regr@12345")["user"]["id"] == uid

    d = s.delete(f"{BASE_URL}/api/admin/members/{uid}", timeout=30)
    assert d.status_code in (200, 204), d.text[:300]
    after_del = s.get(f"{BASE_URL}/api/admin/members", timeout=30).json()["members"]
    assert not any(m["id"] == uid for m in after_del), "member not removed"


# ── seeding helpers (script mode) ──
def seed(count=8):
    s, room_id = admin_session()
    existing = {m.get("username"): m["id"] for m in s.get(f"{BASE_URL}/api/admin/members", timeout=30).json()["members"]}
    out = []
    for i in range(1, count + 1):
        uname = f"{PREFIX}{i}"
        pwd = "Layout@12345"
        if uname in existing:
            uid = existing[uname]
        else:
            r = s.post(f"{BASE_URL}/api/admin/members",
                       json={"name": f"Layout Tester {i}", "username": uname, "password": pwd}, timeout=30)
            assert r.status_code in (200, 201), f"create {uname} -> {r.status_code} {r.text[:200]}"
            b = r.json()
            uid = (b.get("member") or b)["id"]
        d = login(uname, pwd)
        tk = requests.post(f"{BASE_URL}/api/room/token",
                           headers={"Authorization": f"Bearer {d['token']}"},
                           json={"room_id": room_id}, timeout=30)
        assert tk.status_code == 200, f"token {uname} -> {tk.status_code} {tk.text[:200]}"
        tj = tk.json()
        out.append({"username": uname, "id": uid, "token": tj.get("token") or tj.get("access_token"),
                    "url": tj.get("url") or tj.get("ws_url") or tj.get("livekit_url")})
    with open(TOKENS_FILE, "w") as f:
        json.dump(out, f)
    print(f"seeded {len(out)} users -> {TOKENS_FILE}")
    print(json.dumps([{k: v for k, v in o.items() if k != 'token'} for o in out], indent=1))


def cleanup():
    s, _ = admin_session()
    members = s.get(f"{BASE_URL}/api/admin/members", timeout=30).json()["members"]
    removed = []
    for m in members:
        if (m.get("username") or "").startswith(PREFIX) or (m.get("username") or "").startswith("test_regression_"):
            r = s.delete(f"{BASE_URL}/api/admin/members/{m['id']}", timeout=30)
            removed.append((m["username"], r.status_code))
    print("cleanup:", removed)
    left = s.get(f"{BASE_URL}/api/admin/members", timeout=30).json()["members"]
    print("remaining members:", [m.get("username") for m in left])


if __name__ == "__main__":
    if "--cleanup" in sys.argv:
        cleanup()
    else:
        seed(int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8)
