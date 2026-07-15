import os
import logging
from motor.motor_asyncio import AsyncIOMotorClient

log = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return _client


def get_db():
    return get_client()[os.environ["DB_NAME"]]


async def _drop_conflicting_indexes(coll, keys_to_reset: list[tuple[str, dict]]):
    """
    Drop any index on `coll` matching one of the (key_field, expected_opts) pairs
    when the on-disk options differ.  Simple, best-effort — swallows errors.
    """
    try:
        info = await coll.index_information()
    except Exception:
        return
    for key_field, expected in keys_to_reset:
        for name, spec in list(info.items()):
            key = spec.get("key", [])
            if len(key) != 1 or key[0][0] != key_field:
                continue
            is_unique = spec.get("unique", False)
            if is_unique != expected.get("unique", False) or spec.get("sparse", False) != expected.get("sparse", False):
                try:
                    await coll.drop_index(name)
                except Exception:
                    pass


async def create_indexes():
    db = get_db()

    # ---- Rooms: no unique on customer_id; unique on admin_user_id + room_code ----
    await _drop_conflicting_indexes(db.rooms, [
        ("customer_id", {"unique": False}),
        ("admin_user_id", {"unique": True, "sparse": True}),
    ])
    await db.rooms.create_index("room_code", unique=True)
    await db.rooms.create_index("admin_user_id", unique=True, sparse=True)
    await db.rooms.create_index("customer_id")  # legacy, not unique

    # ---- Users ----
    await db.users.create_index("email", unique=True)
    await db.users.create_index("room_id")

    # ---- Password reset + login attempts + sessions ----
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.password_reset_tokens.create_index("token", unique=True)
    await db.login_attempts.create_index("identifier", unique=True)
    await db.sessions.create_index("room_id")
    await db.sessions.create_index("joined_at")
    await db.sessions.create_index("user_id")

    # ---- Recordings ----
    await db.recordings.create_index("room_id")
    await db.recordings.create_index("created_at")


async def migrate_to_3_role_model():
    """
    Migrate from the old 4-tier model (PlatformOwner→Customer→RoomAdmin→User)
    to the new 3-tier model (PlatformOwner→RoomAdmin→User) where:
      - each Room has admin_user_id (points to its Room Admin)
      - each User has room_id (single assigned room)
      - `customers` collection is dropped
    Idempotent — safe to run every startup.
    """
    db = get_db()

    # 1) Assign each room an admin_user_id if missing (from legacy customer_id linkage)
    rooms = await db.rooms.find({}).to_list(2000)
    for room in rooms:
        if room.get("admin_user_id"):
            continue
        cid = room.get("customer_id")
        if not cid:
            continue
        admin = await db.users.find_one({"role": "room_admin", "customer_id": cid})
        if admin:
            await db.rooms.update_one({"id": room["id"]}, {"$set": {"admin_user_id": admin["id"]}})

    # 2) Reduce to one room per admin (delete extras created via Phase-2 multi-room)
    all_rooms = await db.rooms.find({"admin_user_id": {"$exists": True}}).sort("created_at", 1).to_list(2000)
    seen = set()
    to_delete = []
    for r in all_rooms:
        aid = r.get("admin_user_id")
        if not aid:
            continue
        if aid in seen:
            to_delete.append(r["id"])
        else:
            seen.add(aid)
    if to_delete:
        await db.rooms.delete_many({"id": {"$in": to_delete}})
        log.warning(f"Migration: deleted {len(to_delete)} extra room(s) from Phase-2 multi-room")

    # 3) Assign each user a room_id if missing
    users = await db.users.find({"role": {"$in": ["room_admin", "user"]}, "room_id": {"$exists": False}}).to_list(5000)
    for u in users:
        room = None
        if u.get("role") == "room_admin":
            room = await db.rooms.find_one({"admin_user_id": u["id"]})
        if not room and u.get("customer_id"):
            # any surviving room in the same customer
            room = await db.rooms.find_one({"customer_id": u["customer_id"]}, sort=[("created_at", 1)])
        if room:
            await db.users.update_one({"id": u["id"]}, {"$set": {"room_id": room["id"]}})

    # 4) Drop the customers collection entirely (idempotent)
    try:
        await db.customers.drop()
    except Exception:
        pass

    # 5) Clean up orphaned users (customer_id set but no matching room)
    #    Just remove the deprecated customer_id field, leave the users
    await db.users.update_many({}, {"$unset": {"customer_id": ""}})

    # 6) Backfill status on rooms that came from the old model
    await db.rooms.update_many({"status": {"$exists": False}}, {"$set": {"status": "active"}})
