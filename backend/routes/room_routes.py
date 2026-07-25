import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from db import get_db
from models import (
    TokenResponse,
    ModeratorAction,
    RoomTokenRequest,
    SessionStart,
    SessionEnd,
    RoomPublic,
    PLANS,
    DEFAULT_PLAN,
    now_iso,
    new_id,
)
from auth import get_current_user, require_roles
from livekit import api as lk_api

router = APIRouter(prefix="/room", tags=["room"])


def _lk_creds():
    return (
        os.environ.get("LIVEKIT_URL", ""),
        os.environ.get("LIVEKIT_API_KEY", ""),
        os.environ.get("LIVEKIT_API_SECRET", ""),
    )


def _lk_client():
    url, key, secret = _lk_creds()
    if not (url and key and secret):
        raise HTTPException(status_code=500, detail="LiveKit not configured")
    return lk_api.LiveKitAPI(url, key, secret)


async def _get_scoped_room(db, user: dict, room_id: str):
    """Return the room, enforcing that current user has access to it."""
    if user["role"] == "platform_owner":
        raise HTTPException(status_code=403, detail="Platform owner cannot join rooms")
    room = await db.rooms.find_one({"id": room_id}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="Room is suspended")

    if user["role"] == "room_admin":
        if room.get("admin_user_id") != user["id"]:
            raise HTTPException(status_code=404, detail="Room not found")
    elif user["role"] == "user":
        if user.get("room_id") != room["id"]:
            raise HTTPException(status_code=404, detail="Room not found")
    return room


@router.get("/available")
async def list_available(user: dict = Depends(get_current_user)):
    """Room admin: their one assigned room. User: their one assigned room."""
    if user["role"] == "platform_owner":
        raise HTTPException(status_code=403, detail="Owners have no rooms")
    db = get_db()
    if user["role"] == "room_admin":
        room = await db.rooms.find_one({"admin_user_id": user["id"]}, {"_id": 0})
    else:
        rid = user.get("room_id")
        room = await db.rooms.find_one({"id": rid}, {"_id": 0}) if rid else None
    rooms = []
    if room:
        rooms.append(RoomPublic(
            id=room["id"], name=room["name"], room_code=room["room_code"],
            livekit_room_name=room["livekit_room_name"],
            max_participants=room.get("max_participants", 15),
            status=room.get("status", "active"),
            admin_user_id=room.get("admin_user_id"),
            created_at=room["created_at"],
        ).model_dump())
    return {"rooms": rooms}


@router.get("/info/{room_id}")
async def room_info(room_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    room = await _get_scoped_room(db, user, room_id)
    return {"room": room}


@router.post("/token", response_model=TokenResponse)
async def get_livekit_token(payload: RoomTokenRequest, user: dict = Depends(get_current_user)):
    db = get_db()
    room = await _get_scoped_room(db, user, payload.room_id)
    url, key, secret = _lk_creds()
    if not (url and key and secret):
        raise HTTPException(status_code=500, detail="LiveKit not configured")

    plan = PLANS.get(room.get("plan_code", DEFAULT_PLAN)) or PLANS[DEFAULT_PLAN]
    is_host = user["role"] == "room_admin"
    listener_only = bool(plan.get("listener_only") and user["role"] == "user")

    grants = lk_api.VideoGrants(
        room_join=True,
        room=room["livekit_room_name"],
        can_publish=True,
        can_publish_data=True,
        can_subscribe=True,
        room_admin=is_host,
    )
    token = (
        lk_api.AccessToken(key, secret)
        .with_identity(user["id"])
        .with_name(user["name"])
        .with_grants(grants)
        .with_metadata(f'{{"role":"{user["role"]}","name":"{user["name"]}","email":"{user.get("email") or ""}","username":"{user.get("username") or ""}","listenerOnly":{str(listener_only).lower()}}}')
    )
    return TokenResponse(
        token=token.to_jwt(),
        livekit_url=url,
        room_name=room["livekit_room_name"],
        identity=user["id"],
        is_host=is_host,
        listener_only=listener_only,
    )


@router.post("/mute")
async def mute_participant(action: ModeratorAction, user: dict = Depends(require_roles("room_admin"))):
    if not action.track_sid:
        raise HTTPException(status_code=400, detail="track_sid required")
    db = get_db()
    room = await _get_scoped_room(db, user, action.room_id)
    client = _lk_client()
    try:
        await client.room.mute_published_track(
            lk_api.MuteRoomTrackRequest(
                room=room["livekit_room_name"],
                identity=action.identity,
                track_sid=action.track_sid,
                muted=True,
            )
        )
    finally:
        await client.aclose()
    return {"ok": True}


@router.post("/kick")
async def kick_participant(action: ModeratorAction, user: dict = Depends(require_roles("room_admin"))):
    db = get_db()
    room = await _get_scoped_room(db, user, action.room_id)
    client = _lk_client()
    try:
        await client.room.remove_participant(
            lk_api.RoomParticipantIdentity(
                room=room["livekit_room_name"],
                identity=action.identity,
            )
        )
    finally:
        await client.aclose()
    return {"ok": True}


@router.post("/session/start")
async def session_start(payload: SessionStart, user: dict = Depends(get_current_user)):
    db = get_db()
    room = await _get_scoped_room(db, user, payload.room_id)
    session_id = new_id()
    await db.sessions.insert_one({
        "id": session_id,
        "room_id": room["id"],
        "room_name": room["name"],
        "user_id": user["id"],
        "user_name": user["name"],
        "role": user["role"],
        "joined_at": now_iso(),
        "left_at": None,
        "duration_sec": 0,
    })
    return {"session_id": session_id}


@router.post("/session/end")
async def session_end(payload: SessionEnd, user: dict = Depends(get_current_user)):
    db = get_db()
    sess = await db.sessions.find_one({"id": payload.session_id})
    if not sess or sess.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Session not found")
    if sess.get("left_at"):
        return {"ok": True}
    left_at = datetime.now(timezone.utc)
    try:
        joined = datetime.fromisoformat(sess["joined_at"])
        if joined.tzinfo is None:
            joined = joined.replace(tzinfo=timezone.utc)
    except Exception:
        joined = left_at
    duration = max(0, int((left_at - joined).total_seconds()))
    await db.sessions.update_one(
        {"id": payload.session_id},
        {"$set": {"left_at": left_at.isoformat(), "duration_sec": duration}},
    )
    return {"ok": True, "duration_sec": duration}
