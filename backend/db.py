import os
from motor.motor_asyncio import AsyncIOMotorClient

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return _client


def get_db():
    return get_client()[os.environ["DB_NAME"]]


async def create_indexes():
    db = get_db()
    # Migration: drop old unique index on rooms.customer_id (if present) BEFORE creating new one
    try:
        info = await db.rooms.index_information()
        for name, spec in info.items():
            key = spec.get("key", [])
            if len(key) == 1 and key[0][0] == "customer_id" and spec.get("unique"):
                await db.rooms.drop_index(name)
    except Exception:
        pass
    # Users
    await db.users.create_index("email", unique=True)
    await db.users.create_index("customer_id")
    # Customers
    await db.customers.create_index("admin_user_id", unique=True, sparse=True)
    # Rooms — customer_id is NOT unique (multi-room per customer)
    await db.rooms.create_index("room_code", unique=True)
    await db.rooms.create_index("customer_id")
    # Password reset tokens (TTL)
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.password_reset_tokens.create_index("token", unique=True)
    # Login attempts
    await db.login_attempts.create_index("identifier", unique=True)
    # Sessions (analytics)
    await db.sessions.create_index("customer_id")
    await db.sessions.create_index("joined_at")
    await db.sessions.create_index("user_id")
