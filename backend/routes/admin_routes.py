from fastapi import APIRouter, Depends, HTTPException
from db import get_db
from models import RoomMemberCreate, UserPublic, RoomPublic, PLANS, DEFAULT_PLAN, now_iso, new_id
from auth import require_roles, hash_password

router = APIRouter(prefix="/admin", tags=["admin"])
admin_only = require_roles("room_admin")


async def _get_my_room(db, user: dict) -> dict:
    # Room Admin's assignment comes from the room where admin_user_id == user.id
    room = await db.rooms.find_one({"admin_user_id": user["id"]}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="You have no assigned room. Ask the platform owner.")
    return room


def _plan(code: str) -> dict:
    return PLANS.get(code) or PLANS[DEFAULT_PLAN]


@router.get("/room")
async def get_my_room(user: dict = Depends(admin_only)):
    db = get_db()
    room = await _get_my_room(db, user)
    plan = _plan(room.get("plan_code", DEFAULT_PLAN))
    return RoomPublic(
        id=room["id"],
        name=room["name"],
        room_code=room["room_code"],
        livekit_room_name=room["livekit_room_name"],
        max_participants=room.get("max_participants", 15),
        status=room.get("status", "active"),
        admin_user_id=room.get("admin_user_id"),
        member_count=await db.users.count_documents({"room_id": room["id"], "role": "user"}),
        plan_code=room.get("plan_code", DEFAULT_PLAN),
        plan_name=plan["name"],
        listener_only=plan["listener_only"],
        max_users=plan["max_users"],
        created_at=room["created_at"],
    ).model_dump()


@router.get("/members")
async def list_members(user: dict = Depends(admin_only)):
    db = get_db()
    room = await _get_my_room(db, user)
    docs = await db.users.find(
        {"room_id": room["id"], "role": "user"},
        {"password_hash": 0, "_id": 0},
    ).sort("created_at", -1).to_list(500)
    return {"members": [UserPublic(**d).model_dump() for d in docs]}


@router.post("/members", status_code=201)
async def add_member(payload: RoomMemberCreate, user: dict = Depends(admin_only)):
    db = get_db()
    room = await _get_my_room(db, user)
    username = payload.username.strip()
    if await db.users.find_one({"username": username}):
        raise HTTPException(status_code=409, detail="Username already in use")
    plan = _plan(room.get("plan_code", DEFAULT_PLAN))
    count = await db.users.count_documents({"room_id": room["id"], "role": "user"})
    if count >= plan["max_users"]:
        raise HTTPException(
            status_code=400,
            detail=f"Plan limit reached ({plan['max_users']} members on {plan['name']}). Ask the platform owner to upgrade.",
        )
    new_user = {
        "id": new_id(),
        "username": username,
        "password_hash": hash_password(payload.password),
        "name": payload.name,
        "role": "user",
        "room_id": room["id"],
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
    room = await _get_my_room(db, user)
    target = await db.users.find_one({"id": user_id})
    if not target or target.get("role") != "user" or target.get("room_id") != room["id"]:
        raise HTTPException(status_code=404, detail="Member not found in your room")
    await db.users.delete_one({"id": user_id})
    return None
