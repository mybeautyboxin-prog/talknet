import os
import bcrypt
import jwt
import secrets
import string
from datetime import datetime, timezone, timedelta
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from db import get_db

# ------ Password ------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ------ JWT ------
def _jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def _jwt_algo() -> str:
    return os.environ.get("JWT_ALGORITHM", "HS256")


def create_access_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "iat": datetime.now(timezone.utc),
        "type": "access",
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=_jwt_algo())


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, _jwt_secret(), algorithms=[_jwt_algo()])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ------ Room codes ------
def generate_room_code(length: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits
    alphabet = alphabet.replace("O", "").replace("0", "").replace("I", "").replace("1", "")
    return "".join(secrets.choice(alphabet) for _ in range(length))


def generate_reset_token() -> str:
    return secrets.token_urlsafe(32)


# ------ Brute force / lockout ------
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


async def check_and_get_lockout(identifier: str):
    db = get_db()
    rec = await db.login_attempts.find_one({"identifier": identifier})
    if not rec:
        return None
    locked_until = rec.get("locked_until")
    if locked_until:
        try:
            lu = datetime.fromisoformat(locked_until)
            if lu.tzinfo is None:
                lu = lu.replace(tzinfo=timezone.utc)
        except Exception:
            return None
        if lu > datetime.now(timezone.utc):
            return lu
        # Expired lockout — clear it
        await db.login_attempts.delete_one({"identifier": identifier})
    return None


async def record_failed_login(identifier: str) -> int:
    db = get_db()
    rec = await db.login_attempts.find_one({"identifier": identifier})
    count = (rec.get("count", 0) if rec else 0) + 1
    update = {"count": count, "last_attempt": datetime.now(timezone.utc).isoformat()}
    if count >= MAX_LOGIN_ATTEMPTS:
        update["locked_until"] = (
            datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_MINUTES)
        ).isoformat()
        update["count"] = 0  # reset counter after locking
    await db.login_attempts.update_one(
        {"identifier": identifier},
        {"$set": update, "$setOnInsert": {"identifier": identifier}},
        upsert=True,
    )
    return count


async def clear_login_attempts(identifier: str):
    db = get_db()
    await db.login_attempts.delete_one({"identifier": identifier})


# ------ FastAPI deps ------
bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    token: str | None = None
    if creds and creds.scheme.lower() == "bearer":
        token = creds.credentials
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    db = get_db()
    user = await db.users.find_one({"id": payload["sub"]}, {"password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="Account suspended")
    user.pop("_id", None)
    return user


def require_roles(*roles: str):
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    return dep
