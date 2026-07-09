import os
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from db import get_db
from models import UserLogin, UserPublic, ForgotPasswordRequest, ResetPasswordRequest, now_iso
from auth import (
    verify_password,
    create_access_token,
    get_current_user,
    hash_password,
    generate_reset_token,
    check_and_get_lockout,
    record_failed_login,
    clear_login_attempts,
    MAX_LOGIN_ATTEMPTS,
    LOCKOUT_MINUTES,
)

router = APIRouter(prefix="/auth", tags=["auth"])
log = logging.getLogger(__name__)


def _to_public(u: dict) -> dict:
    u.pop("_id", None)
    u.pop("password_hash", None)
    return u


def _identifier(request: Request, email: str) -> str:
    ip = request.client.host if request.client else "unknown"
    return f"{ip}:{email.lower().strip()}"


@router.post("/login")
async def login(payload: UserLogin, request: Request):
    db = get_db()
    email = payload.email.lower().strip()
    ident = _identifier(request, email)

    locked_until = await check_and_get_lockout(ident)
    if locked_until:
        remaining = int((locked_until - datetime.now(timezone.utc)).total_seconds() / 60) + 1
        raise HTTPException(status_code=429, detail=f"Too many failed attempts. Try again in {remaining} minute(s).")

    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        count = await record_failed_login(ident)
        remaining = MAX_LOGIN_ATTEMPTS - count
        if remaining <= 0:
            raise HTTPException(status_code=429, detail=f"Too many failed attempts. Locked for {LOCKOUT_MINUTES} minutes.")
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="Account suspended")

    await clear_login_attempts(ident)
    token = create_access_token(user["id"], user["role"])
    return {
        "token": token,
        "user": UserPublic(**_to_public(dict(user))).model_dump(),
    }


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": UserPublic(**_to_public(user)).model_dump()}


@router.post("/logout")
async def logout(user: dict = Depends(get_current_user)):
    return {"ok": True}


@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest, request: Request):
    """Always returns 200 (privacy). If the email exists, a token is created and the reset link is logged."""
    db = get_db()
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if user:
        token = generate_reset_token()
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        await db.password_reset_tokens.insert_one({
            "token": token,
            "user_id": user["id"],
            "email": email,
            "expires_at": expires_at,  # actual Date for TTL
            "used": False,
            "created_at": now_iso(),
        })
        frontend_base = request.headers.get("origin") or os.environ.get("FRONTEND_URL", "")
        reset_link = f"{frontend_base}/reset-password?token={token}"
        log.warning("=" * 60)
        log.warning(f"PASSWORD RESET REQUESTED for {email}")
        log.warning("Reset link (valid 1 hour):")
        log.warning(f"  {reset_link}")
        log.warning(f"Token: {token}")
        log.warning("=" * 60)
    return {"ok": True, "message": "If that email exists, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password(payload: ResetPasswordRequest):
    db = get_db()
    rec = await db.password_reset_tokens.find_one({"token": payload.token})
    if not rec:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")
    if rec.get("used"):
        raise HTTPException(status_code=400, detail="This reset link has already been used")

    exp = rec.get("expires_at")
    if isinstance(exp, str):
        try:
            exp = datetime.fromisoformat(exp)
        except Exception:
            exp = None
    if exp and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if not exp or exp < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This reset link has expired")

    await db.users.update_one(
        {"id": rec["user_id"]},
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    await db.password_reset_tokens.update_one({"token": payload.token}, {"$set": {"used": True}})
    return {"ok": True, "message": "Password reset successfully"}
