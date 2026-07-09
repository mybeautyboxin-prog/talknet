from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import logging
from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware

from db import get_db, create_indexes
from auth import hash_password, verify_password
from models import now_iso, new_id

from routes.auth_routes import router as auth_router
from routes.platform_routes import router as platform_router
from routes.admin_routes import router as admin_router
from routes.room_routes import router as room_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="TalkNet — Audio Conferencing Platform", version="0.1.0")

api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"service": "TalkNet API", "status": "ok"}


@api_router.get("/health")
async def health():
    return {"status": "healthy"}


api_router.include_router(auth_router)
api_router.include_router(platform_router)
api_router.include_router(admin_router)
api_router.include_router(room_router)

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


async def seed_platform_owner():
    db = get_db()
    email = os.environ.get("OWNER_EMAIL", "owner@platform.com").lower().strip()
    password = os.environ.get("OWNER_PASSWORD", "Owner@12345")
    existing = await db.users.find_one({"email": email})
    if existing is None:
        await db.users.insert_one({
            "id": new_id(),
            "email": email,
            "password_hash": hash_password(password),
            "name": "Platform Owner",
            "role": "platform_owner",
            "customer_id": None,
            "status": "active",
            "created_at": now_iso(),
        })
        logger.info(f"Seeded platform owner: {email}")
    else:
        # Keep password in sync with env
        if not verify_password(password, existing.get("password_hash", "")):
            await db.users.update_one(
                {"email": email},
                {"$set": {"password_hash": hash_password(password), "role": "platform_owner", "status": "active"}},
            )
            logger.info("Updated platform owner password from env")


@app.on_event("startup")
async def _startup():
    await create_indexes()
    await seed_platform_owner()


@app.on_event("shutdown")
async def _shutdown():
    pass
