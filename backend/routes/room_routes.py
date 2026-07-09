import os
from fastapi import APIRouter, Depends, HTTPException
from db import get_db
from models import TokenResponse, ModeratorAction
from auth import get_current_user, require_roles
from livekit import api as lk_api

router = APIRouter(prefix="/room", tags=["room"])


def _lk_creds():
    url = os.environ.get("LIVEKIT_URL", "")
    key = os.environ.get("LIVEKIT_API_KEY", "")
    secret = os.environ.get("LIVEKIT_API_SECRET", "")
    return url, key, secret


def _lk_client():
    url, key, secret = _lk_creds()
    if not (url and key and secret):
        raise HTTPException(status_code=500, detail="LiveKit not configured")
    return lk_api.LiveKitAPI(url, key, secret)


async def _resolve_user_room(db, user: dict):
    if not user.get("customer_id"):
        raise HTTPException(status_code=400, detail="No customer assigned")
    customer = await db.customers.find_one({"id": user["customer_id"]}, {"_id": 0})
    if not customer or customer.get("status") != "active":
        raise HTTPException(status_code=403, detail="Customer is suspended")
    room = await db.rooms.find_one({"customer_id": user["customer_id"]}, {"_id": 0})
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return customer, room


@router.get("/info")
async def room_info(user: dict = Depends(get_current_user)):
    if user["role"] == "platform_owner":
        raise HTTPException(status_code=403, detail="Owners have no room")
    db = get_db()
    _, room = await _resolve_user_room(db, user)
    return {"room": room}


@router.post("/token", response_model=TokenResponse)
async def get_livekit_token(user: dict = Depends(get_current_user)):
    if user["role"] == "platform_owner":
        raise HTTPException(status_code=403, detail="Platform owner cannot join rooms")

    db = get_db()
    _, room = await _resolve_user_room(db, user)

    url, key, secret = _lk_creds()
    if not (url and key and secret):
        raise HTTPException(status_code=500, detail="LiveKit not configured")

    is_host = user["role"] == "room_admin"
    identity = user["id"]
    display_name = user["name"]

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
        .with_identity(identity)
        .with_name(display_name)
        .with_grants(grants)
        .with_metadata(f'{{"role":"{user["role"]}","name":"{display_name}"}}')
    )
    jwt_token = token.to_jwt()

    return TokenResponse(
        token=jwt_token,
        livekit_url=url,
        room_name=room["livekit_room_name"],
        identity=identity,
        is_host=is_host,
    )


@router.post("/mute")
async def mute_participant(action: ModeratorAction, user: dict = Depends(require_roles("room_admin"))):
    if not action.track_sid:
        raise HTTPException(status_code=400, detail="track_sid required")
    db = get_db()
    _, room = await _resolve_user_room(db, user)

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
    _, room = await _resolve_user_room(db, user)
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
