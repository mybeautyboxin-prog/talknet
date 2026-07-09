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
    room = None
    if customer.get("admin_user_id"):
        adoc = await db.users.find_one({"id": customer["admin_user_id"]}, {"password_hash": 0, "_id": 0})
        if adoc:
            admin = UserPublic(**adoc).model_dump()
    if customer.get("room_id"):
        rdoc = await db.rooms.find_one({"id": customer["room_id"]}, {"_id": 0})
        if rdoc:
            room = RoomPublic(**rdoc).model_dump()
    member_count = await db.users.count_documents({"customer_id": customer["id"], "role": "user"})
    return CustomerPublic(
        id=customer["id"],
        name=customer["name"],
        status=customer.get("status", "active"),
        created_at=customer["created_at"],
        admin=admin,
        room=room,
        member_count=member_count,
    ).model_dump()


@router.post("/customers", status_code=201)
async def create_customer(payload: CustomerCreate, _user: dict = Depends(owner_only)):
    db = get_db()
    email = payload.admin_email.lower().strip()

    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Admin email already in use")

    customer_id = new_id()
    admin_user_id = new_id()
    room_id = new_id()

    # Generate unique room code
    for _ in range(10):
        code = generate_room_code()
        if not await db.rooms.find_one({"room_code": code}):
            break
    else:
        raise HTTPException(status_code=500, detail="Could not generate unique room code")

    livekit_room_name = f"room_{room_id.replace('-', '')[:16]}"

    # Insert admin user
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

    # Insert room
    await db.rooms.insert_one({
        "id": room_id,
        "customer_id": customer_id,
        "name": payload.room_name,
        "room_code": code,
        "livekit_room_name": livekit_room_name,
        "max_participants": 15,
        "created_at": now_iso(),
    })

    # Insert customer
    customer_doc = {
        "id": customer_id,
        "name": payload.customer_name,
        "admin_user_id": admin_user_id,
        "room_id": room_id,
        "status": "active",
        "created_at": now_iso(),
    }
    await db.customers.insert_one(customer_doc)

    return await _assemble_customer(db, customer_doc)


@router.get("/customers")
async def list_customers(_user: dict = Depends(owner_only)):
    db = get_db()
    docs = await db.customers.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"customers": [await _assemble_customer(db, d) for d in docs]}


@router.get("/customers/{customer_id}")
async def get_customer(customer_id: str, _user: dict = Depends(owner_only)):
    db = get_db()
    doc = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Customer not found")
    return await _assemble_customer(db, doc)


@router.patch("/customers/{customer_id}")
async def update_customer_status(customer_id: str, payload: CustomerStatusUpdate, _user: dict = Depends(owner_only)):
    db = get_db()
    res = await db.customers.update_one({"id": customer_id}, {"$set": {"status": payload.status}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Customer not found")
    # Cascade status to admin & users
    await db.users.update_many({"customer_id": customer_id}, {"$set": {"status": payload.status}})
    doc = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    return await _assemble_customer(db, doc)


@router.delete("/customers/{customer_id}", status_code=204)
async def delete_customer(customer_id: str, _user: dict = Depends(owner_only)):
    db = get_db()
    doc = await db.customers.find_one({"id": customer_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Customer not found")
    await db.users.delete_many({"customer_id": customer_id})
    await db.rooms.delete_many({"customer_id": customer_id})
    await db.customers.delete_one({"id": customer_id})
    return None


@router.get("/stats")
async def platform_stats(_user: dict = Depends(owner_only)):
    db = get_db()
    total_customers = await db.customers.count_documents({})
    active_customers = await db.customers.count_documents({"status": "active"})
    total_users = await db.users.count_documents({"role": "user"})
    total_admins = await db.users.count_documents({"role": "room_admin"})
    return {
        "total_customers": total_customers,
        "active_customers": active_customers,
        "total_users": total_users,
        "total_admins": total_admins,
    }
