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
    await db.users.create_index("email", unique=True)
    await db.customers.create_index("admin_user_id", unique=True, sparse=True)
    await db.rooms.create_index("room_code", unique=True)
    await db.rooms.create_index("customer_id", unique=True)
