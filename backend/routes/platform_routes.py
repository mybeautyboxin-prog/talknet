from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from db import get_db
from models import (
    RoomProvision,
    RoomStatusUpdate,
    RoomPublic,
    UserPublic,
    now_iso,
    new_id,
)
from auth import require_roles, hash_password, generate_room_code

router = APIRouter(prefix="/platform", tags=["platform"])
owner_only = require_roles("platform_owner")


async def _assemble_room(db, room: dict) -> dict:
    admin = None
    if room.get("admin_user_id"):
        adoc = await db.users.find_one({"id": room["admin_user_id"]}, {"password_hash": 0, "_id": 0})
        if adoc:
            admin = UserPublic(**adoc).model_dump()
    member_count = await db.users.count_documents({"room_id": room["id"], "role": "user"})
    return RoomPublic(
        id=room["id"],
        name=room["name"],
        room_code=room["room_code"],
        livekit_room_name=room["livekit_room_name"],
        max_participants=room.get("max_participants", 15),
        status=room.get("status", "active"),
        admin_user_id=room.get("admin_user_id"),
        admin=admin,
        member_count=member_count,
        created_at=room["created_at"],
    ).model_dump()


@router.post("/rooms", status_code=201)
async def provision_room(payload: RoomProvision, _u: dict = Depends(owner_only)):
    """Provision a new room + its Room Admin in one call."""
    db = get_db()
    email = payload.admin_email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Admin email already in use")

    room_id = new_id()
    admin_user_id = new_id()

    for _ in range(10):
        code = generate_room_code()
        if not await db.rooms.find_one({"room_code": code}):
            break
    else:
        raise HTTPException(status_code=500, detail="Could not generate unique room code")

    # Insert room FIRST (so a room-insert failure doesn't orphan the admin user)
    room_doc = {
        "id": room_id,
        "name": payload.room_name,
        "room_code": code,
        "livekit_room_name": f"room_{room_id.replace('-', '')[:16]}",
        "max_participants": 15,
        "status": "active",
        "admin_user_id": admin_user_id,
        "created_at": now_iso(),
    }
    await db.rooms.insert_one(room_doc)

    # Then the admin — if this fails, roll back the room
    try:
        await db.users.insert_one({
            "id": admin_user_id,
            "email": email,
            "password_hash": hash_password(payload.admin_password),
            "name": payload.admin_name,
            "role": "room_admin",
            "room_id": room_id,
            "status": "active",
            "created_at": now_iso(),
        })
    except Exception:
        await db.rooms.delete_one({"id": room_id})
        raise

    return await _assemble_room(db, room_doc)


@router.get("/rooms")
async def list_rooms(_u: dict = Depends(owner_only)):
    db = get_db()
    docs = await db.rooms.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"rooms": [await _assemble_room(db, d) for d in docs]}


@router.get("/rooms/{room_id}")
async def get_room(room_id: str, _u: dict = Depends(owner_only)):
    db = get_db()
    doc = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Room not found")
    return await _assemble_room(db, doc)


@router.patch("/rooms/{room_id}")
async def update_room_status(room_id: str, payload: RoomStatusUpdate, _u: dict = Depends(owner_only)):
    db = get_db()
    room = await db.rooms.find_one({"id": room_id})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    await db.rooms.update_one({"id": room_id}, {"$set": {"status": payload.status}})
    # Cascade to admin + members
    await db.users.update_many({"room_id": room_id}, {"$set": {"status": payload.status}})
    doc = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    return await _assemble_room(db, doc)


@router.delete("/rooms/{room_id}", status_code=204)
async def delete_room(room_id: str, _u: dict = Depends(owner_only)):
    db = get_db()
    room = await db.rooms.find_one({"id": room_id})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    # Delete everyone (admin + users) belonging to this room
    await db.users.delete_many({"room_id": room_id})
    await db.sessions.delete_many({"room_id": room_id})
    await db.rooms.delete_one({"id": room_id})
    return None


@router.get("/stats")
async def platform_stats(_u: dict = Depends(owner_only)):
    db = get_db()
    total_rooms = await db.rooms.count_documents({})
    active_rooms = await db.rooms.count_documents({"status": "active"})
    total_admins = await db.users.count_documents({"role": "room_admin"})
    total_users = await db.users.count_documents({"role": "user"})
    return {
        "total_rooms": total_rooms,
        "active_rooms": active_rooms,
        "total_admins": total_admins,
        "total_users": total_users,
    }


@router.get("/analytics")
async def platform_analytics(days: int = 14, _u: dict = Depends(owner_only)):
    db = get_db()
    since = datetime.now(timezone.utc) - timedelta(days=days)
    since_iso = since.isoformat()

    daily_pipe = [
        {"$match": {"joined_at": {"$gte": since_iso}}},
        {"$project": {"day": {"$substrCP": ["$joined_at", 0, 10]}, "duration_sec": 1}},
        {"$group": {"_id": "$day", "sessions": {"$sum": 1}, "minutes": {"$sum": {"$divide": ["$duration_sec", 60]}}}},
        {"$sort": {"_id": 1}},
        {"$project": {"_id": 0, "day": "$_id", "sessions": 1, "minutes": {"$round": ["$minutes", 1]}}},
    ]
    daily = await db.sessions.aggregate(daily_pipe).to_list(100)

    top_pipe = [
        {"$match": {"joined_at": {"$gte": since_iso}}},
        {"$group": {"_id": "$room_id", "minutes": {"$sum": {"$divide": ["$duration_sec", 60]}}, "sessions": {"$sum": 1}}},
        {"$sort": {"minutes": -1}},
        {"$limit": 5},
    ]
    top_raw = await db.sessions.aggregate(top_pipe).to_list(20)
    top = []
    for t in top_raw:
        r = await db.rooms.find_one({"id": t["_id"]}, {"_id": 0, "name": 1})
        top.append({
            "room_id": t["_id"],
            "room_name": r["name"] if r else "(deleted)",
            "minutes": round(t["minutes"], 1),
            "sessions": t["sessions"],
        })

    total_sessions = await db.sessions.count_documents({"joined_at": {"$gte": since_iso}})
    tm_res = await db.sessions.aggregate([
        {"$match": {"joined_at": {"$gte": since_iso}}},
        {"$group": {"_id": None, "m": {"$sum": {"$divide": ["$duration_sec", 60]}}}},
    ]).to_list(1)
    total_minutes = round(tm_res[0]["m"], 1) if tm_res else 0.0

    return {"days": days, "total_sessions": total_sessions, "total_minutes": total_minutes, "daily": daily, "top_rooms": top}
