from fastapi import APIRouter, Depends, HTTPException
from db import get_db
from models import UserLogin, UserPublic
from auth import verify_password, create_access_token, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


def _to_public(u: dict) -> dict:
    u.pop("_id", None)
    u.pop("password_hash", None)
    return u


@router.post("/login")
async def login(payload: UserLogin):
    db = get_db()
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="Account suspended")

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
    # Stateless JWT — client discards the token
    return {"ok": True}
