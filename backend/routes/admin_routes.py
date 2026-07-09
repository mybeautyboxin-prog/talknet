from fastapi import APIRouter, Depends, HTTPException
from db import get_db
from models import RoomMemberCreate, UserPublic, RoomPublic, now_iso, new_id
from auth import require_roles, hash_password

router = APIRouter(prefix="/admin", tags=["admin"])

admin_only = require_roles("room_admin")


async def _get_my_room(db, user: dict) -> dict:
    if not user.get("customer_id"):
        raise HTTPException(status_code=400, detail="Admin has no assigned customer")
    room = await db.rooms.find_one({"customer_id": user["customer_id"]}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found for your customer")
    return room


@router.get("/room")
async def get_my_room(user: dict = Depends(admin_only)):
    db = get_db()
    room = await _get_my_room(db, user)
    return RoomPublic(**room).model_dump()


@router.get("/members")
async def list_members(user: dict = Depends(admin_only)):
    db = get_db()
    docs = await db.users.find(
        {"customer_id": user["customer_id"], "role": "user"},
        {"password_hash": 0, "_id": 0},
    ).sort("created_at", -1).to_list(500)
    return {"members": [UserPublic(**d).model_dump() for d in docs]}


@router.post("/members", status_code=201)
async def add_member(payload: RoomMemberCreate, user: dict = Depends(admin_only)):
    db = get_db()
    email = payload.email.lower().strip()

    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already in use")

    # Enforce max 15 members
    count = await db.users.count_documents({"customer_id": user["customer_id"], "role": "user"})
    if count >= 15:
        raise HTTPException(status_code=400, detail="Room limit reached (15 members)")

    new_user = {
        "id": new_id(),
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name,
        "role": "user",
        "customer_id": user["customer_id"],
        "status": "active",
        "created_at": now_iso(),
    }
    await db.users.insert_one(new_user)
    pub = dict(new_user)
    pub.pop("password_hash", None)
    return UserPublic(**pub).model_dump()


@router.delete("/members/{user_id}", status_code=204)
async def remove_member(user_id: str, user: dict = Depends(admin_only)):
    db = get_db()
    target = await db.users.find_one({"id": user_id})
    if not target or target.get("role") != "user" or target.get("customer_id") != user["customer_id"]:
        raise HTTPException(status_code=404, detail="Member not found")
    await db.users.delete_one({"id": user_id})
    return None
