from fastapi import APIRouter, Depends, HTTPException
from db import get_db
from models import (
    RoomMemberCreate,
    RoomCreate,
    UserPublic,
    RoomPublic,
    now_iso,
    new_id,
)
from auth import require_roles, hash_password, generate_room_code

router = APIRouter(prefix="/admin", tags=["admin"])
admin_only = require_roles("room_admin")


async def _ensure_customer(user: dict) -> str:
    if not user.get("customer_id"):
        raise HTTPException(status_code=400, detail="Admin has no assigned customer")
    return user["customer_id"]


# ---------- Rooms ----------
@router.get("/rooms")
async def list_rooms(user: dict = Depends(admin_only)):
    db = get_db()
    cid = await _ensure_customer(user)
    docs = await db.rooms.find({"customer_id": cid}, {"_id": 0}).sort("created_at", 1).to_list(100)
    return {"rooms": [RoomPublic(**d).model_dump() for d in docs]}


@router.post("/rooms", status_code=201)
async def create_room(payload: RoomCreate, user: dict = Depends(admin_only)):
    db = get_db()
    cid = await _ensure_customer(user)

    # Reasonable per-customer room cap
    count = await db.rooms.count_documents({"customer_id": cid})
    if count >= 20:
        raise HTTPException(status_code=400, detail="Room limit reached (20 rooms per customer)")

    room_id = new_id()
    for _ in range(10):
        code = generate_room_code()
        if not await db.rooms.find_one({"room_code": code}):
            break
    else:
        raise HTTPException(status_code=500, detail="Could not generate unique room code")

    doc = {
        "id": room_id,
        "customer_id": cid,
        "name": payload.name,
        "room_code": code,
        "livekit_room_name": f"room_{room_id.replace('-', '')[:16]}",
        "max_participants": 15,
        "created_at": now_iso(),
    }
    await db.rooms.insert_one(doc)
    return RoomPublic(**doc).model_dump()


@router.delete("/rooms/{room_id}", status_code=204)
async def delete_room(room_id: str, user: dict = Depends(admin_only)):
    db = get_db()
    cid = await _ensure_customer(user)
    room = await db.rooms.find_one({"id": room_id})
    if not room or room.get("customer_id") != cid:
        raise HTTPException(status_code=404, detail="Room not found")
    # Prevent deleting the last room — must always have at least one
    remaining = await db.rooms.count_documents({"customer_id": cid})
    if remaining <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last room. Create another one first.")
    await db.rooms.delete_one({"id": room_id})
    return None


# ---------- Backward-compatible single-room endpoint ----------
@router.get("/room")
async def get_default_room(user: dict = Depends(admin_only)):
    db = get_db()
    cid = await _ensure_customer(user)
    room = await db.rooms.find_one({"customer_id": cid}, {"_id": 0}, sort=[("created_at", 1)])
    if not room:
        raise HTTPException(status_code=404, detail="Room not found for your customer")
    return RoomPublic(**room).model_dump()


# ---------- Members ----------
@router.get("/members")
async def list_members(user: dict = Depends(admin_only)):
    db = get_db()
    cid = await _ensure_customer(user)
    docs = await db.users.find(
        {"customer_id": cid, "role": "user"},
        {"password_hash": 0, "_id": 0},
    ).sort("created_at", -1).to_list(500)
    return {"members": [UserPublic(**d).model_dump() for d in docs]}


@router.post("/members", status_code=201)
async def add_member(payload: RoomMemberCreate, user: dict = Depends(admin_only)):
    db = get_db()
    cid = await _ensure_customer(user)
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email already in use")
    count = await db.users.count_documents({"customer_id": cid, "role": "user"})
    if count >= 15:
        raise HTTPException(status_code=400, detail="Room limit reached (15 members)")
    new_user = {
        "id": new_id(),
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name,
        "role": "user",
        "customer_id": cid,
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
    cid = await _ensure_customer(user)
    target = await db.users.find_one({"id": user_id})
    if not target or target.get("role") != "user" or target.get("customer_id") != cid:
        raise HTTPException(status_code=404, detail="Member not found")
    await db.users.delete_one({"id": user_id})
    return None
