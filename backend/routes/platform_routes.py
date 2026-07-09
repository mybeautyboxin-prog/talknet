from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from db import get_db
from models import (
    CustomerCreate,
    CustomerPublic,
    CustomerStatusUpdate,
    UserPublic,
    RoomPublic,
    now_iso,
    new_id,
)
from auth import require_roles, hash_password, generate_room_code

router = APIRouter(prefix="/platform", tags=["platform"])
owner_only = require_roles("platform_owner")


async def _assemble_customer(db, customer: dict) -> dict:
    admin = None
    default_room = None
    if customer.get("admin_user_id"):
        adoc = await db.users.find_one({"id": customer["admin_user_id"]}, {"password_hash": 0, "_id": 0})
        if adoc:
            admin = UserPublic(**adoc).model_dump()
    # Default (first) room
    rdoc = await db.rooms.find_one({"customer_id": customer["id"]}, {"_id": 0}, sort=[("created_at", 1)])
    if rdoc:
        default_room = RoomPublic(**rdoc).model_dump()
    room_count = await db.rooms.count_documents({"customer_id": customer["id"]})
    member_count = await db.users.count_documents({"customer_id": customer["id"], "role": "user"})
    return CustomerPublic(
        id=customer["id"],
        name=customer["name"],
        status=customer.get("status", "active"),
        created_at=customer["created_at"],
        admin=admin,
        default_room=default_room,
        room_count=room_count,
        member_count=member_count,
    ).model_dump()


@router.post("/customers", status_code=201)
async def create_customer(payload: CustomerCreate, _u: dict = Depends(owner_only)):
    db = get_db()
    email = payload.admin_email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Admin email already in use")

    customer_id = new_id()
    admin_user_id = new_id()
    room_id = new_id()

    for _ in range(10):
        code = generate_room_code()
        if not await db.rooms.find_one({"room_code": code}):
            break
    else:
        raise HTTPException(status_code=500, detail="Could not generate unique room code")

    await db.users.insert_one({
        "id": admin_user_id,
        "email": email,
        "password_hash": hash_password(payload.admin_password),
        "name": payload.admin_name,
        "role": "room_admin",
        "customer_id": customer_id,
        "status": "active",
        "created_at": now_iso(),
    })
    await db.rooms.insert_one({
        "id": room_id,
        "customer_id": customer_id,
        "name": payload.room_name,
        "room_code": code,
        "livekit_room_name": f"room_{room_id.replace('-', '')[:16]}",
        "max_participants": 15,
        "created_at": now_iso(),
    })
    customer_doc = {
        "id": customer_id,
        "name": payload.customer_name,
        "admin_user_id": admin_user_id,
        "status": "active",
        "created_at": now_iso(),
    }
    await db.customers.insert_one(customer_doc)
    return await _assemble_customer(db, customer_doc)


@router.get("/customers")
async def list_customers(_u: dict = Depends(owner_only)):
    db = get_db()
    docs = await db.customers.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"customers": [await _assemble_customer(db, d) for d in docs]}


@router.get("/customers/{customer_id}")
async def get_customer(customer_id: str, _u: dict = Depends(owner_only)):
    db = get_db()
    doc = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Customer not found")
    return await _assemble_customer(db, doc)


@router.patch("/customers/{customer_id}")
async def update_customer_status(customer_id: str, payload: CustomerStatusUpdate, _u: dict = Depends(owner_only)):
    db = get_db()
    res = await db.customers.update_one({"id": customer_id}, {"$set": {"status": payload.status}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Customer not found")
    await db.users.update_many({"customer_id": customer_id}, {"$set": {"status": payload.status}})
    doc = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    return await _assemble_customer(db, doc)


@router.delete("/customers/{customer_id}", status_code=204)
async def delete_customer(customer_id: str, _u: dict = Depends(owner_only)):
    db = get_db()
    doc = await db.customers.find_one({"id": customer_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Customer not found")
    await db.users.delete_many({"customer_id": customer_id})
    await db.rooms.delete_many({"customer_id": customer_id})
    await db.sessions.delete_many({"customer_id": customer_id})
    await db.customers.delete_one({"id": customer_id})
    return None


@router.get("/stats")
async def platform_stats(_u: dict = Depends(owner_only)):
    db = get_db()
    total_customers = await db.customers.count_documents({})
    active_customers = await db.customers.count_documents({"status": "active"})
    total_users = await db.users.count_documents({"role": "user"})
    total_admins = await db.users.count_documents({"role": "room_admin"})
    total_rooms = await db.rooms.count_documents({})
    return {
        "total_customers": total_customers,
        "active_customers": active_customers,
        "total_users": total_users,
        "total_admins": total_admins,
        "total_rooms": total_rooms,
    }


@router.get("/analytics")
async def platform_analytics(days: int = 14, _u: dict = Depends(owner_only)):
    db = get_db()
    since = datetime.now(timezone.utc) - timedelta(days=days)
    since_iso = since.isoformat()

    # Sessions per day
    pipeline_daily = [
        {"$match": {"joined_at": {"$gte": since_iso}}},
        {"$project": {
            "day": {"$substrCP": ["$joined_at", 0, 10]},
            "duration_sec": 1,
        }},
        {"$group": {
            "_id": "$day",
            "sessions": {"$sum": 1},
            "minutes": {"$sum": {"$divide": ["$duration_sec", 60]}},
        }},
        {"$sort": {"_id": 1}},
        {"$project": {"_id": 0, "day": "$_id", "sessions": 1, "minutes": {"$round": ["$minutes", 1]}}},
    ]
    daily = await db.sessions.aggregate(pipeline_daily).to_list(100)

    # Top customers by minutes
    pipeline_top = [
        {"$match": {"joined_at": {"$gte": since_iso}}},
        {"$group": {
            "_id": "$customer_id",
            "minutes": {"$sum": {"$divide": ["$duration_sec", 60]}},
            "sessions": {"$sum": 1},
        }},
        {"$sort": {"minutes": -1}},
        {"$limit": 5},
    ]
    top_raw = await db.sessions.aggregate(pipeline_top).to_list(20)
    top = []
    for t in top_raw:
        c = await db.customers.find_one({"id": t["_id"]}, {"_id": 0, "name": 1})
        top.append({
            "customer_id": t["_id"],
            "customer_name": c["name"] if c else "(deleted)",
            "minutes": round(t["minutes"], 1),
            "sessions": t["sessions"],
        })

    total_sessions = await db.sessions.count_documents({"joined_at": {"$gte": since_iso}})
    total_minutes_res = await db.sessions.aggregate([
        {"$match": {"joined_at": {"$gte": since_iso}}},
        {"$group": {"_id": None, "m": {"$sum": {"$divide": ["$duration_sec", 60]}}}},
    ]).to_list(1)
    total_minutes = round(total_minutes_res[0]["m"], 1) if total_minutes_res else 0.0

    return {
        "days": days,
        "total_sessions": total_sessions,
        "total_minutes": total_minutes,
        "daily": daily,
        "top_customers": top,
    }
