import os
import aiofiles
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from db import get_db
from models import now_iso, new_id
from auth import require_roles, get_current_user

router = APIRouter(prefix="/admin/recordings", tags=["recordings"])
admin_only = require_roles("room_admin")

RECORDINGS_DIR = Path(os.environ.get("RECORDINGS_DIR", "/app/backend/recordings"))
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_BYTES = 200 * 1024 * 1024  # 200 MB per recording — enough for ~3 hours of Opus


async def _resolve_room_for_upload(db, user: dict) -> dict:
    """Any participant (admin or user) can upload for their own room."""
    if user["role"] == "room_admin":
        room = await db.rooms.find_one({"admin_user_id": user["id"]})
    elif user["role"] == "user":
        rid = user.get("room_id")
        room = await db.rooms.find_one({"id": rid}) if rid else None
    else:
        raise HTTPException(status_code=403, detail="Not allowed")
    if not room:
        raise HTTPException(status_code=404, detail="No assigned room")
    return room


async def _my_room(db, user: dict) -> dict:
    room = await db.rooms.find_one({"admin_user_id": user["id"]})
    if not room:
        raise HTTPException(status_code=404, detail="No assigned room")
    return room


@router.post("", status_code=201)
async def upload_recording(
    file: UploadFile = File(...),
    duration_sec: int = Form(0),
    started_at: str = Form(""),
    ext: str = Form("webm"),
    user: dict = Depends(get_current_user),
):
    db = get_db()
    room = await _resolve_room_for_upload(db, user)

    safe_ext = ext.lower().strip().replace(".", "")
    if safe_ext not in ("webm", "ogg", "mp3", "mp4", "m4a", "wav"):
        safe_ext = "webm"

    rec_id = new_id()
    room_dir = RECORDINGS_DIR / room["id"]
    room_dir.mkdir(parents=True, exist_ok=True)
    filepath = room_dir / f"{rec_id}.{safe_ext}"

    total = 0
    async with aiofiles.open(filepath, "wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                await out.close()
                try:
                    filepath.unlink()
                except Exception:
                    pass
                raise HTTPException(status_code=413, detail="Recording exceeds 200 MB limit")
            await out.write(chunk)

    doc = {
        "id": rec_id,
        "room_id": room["id"],
        "room_name": room["name"],
        "uploader_user_id": user["id"],
        "uploader_name": user["name"],
        "filename": f"{rec_id}.{safe_ext}",
        "mime_type": file.content_type or f"audio/{safe_ext}",
        "size_bytes": total,
        "duration_sec": duration_sec,
        "started_at": started_at or now_iso(),
        "created_at": now_iso(),
    }
    await db.recordings.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("")
async def list_recordings(user: dict = Depends(admin_only)):
    db = get_db()
    room = await _my_room(db, user)
    docs = await db.recordings.find(
        {"room_id": room["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return {"recordings": docs}


@router.get("/{recording_id}/file")
async def download_recording(recording_id: str, user: dict = Depends(admin_only)):
    db = get_db()
    room = await _my_room(db, user)
    rec = await db.recordings.find_one({"id": recording_id})
    if not rec or rec.get("room_id") != room["id"]:
        raise HTTPException(status_code=404, detail="Recording not found")
    filepath = RECORDINGS_DIR / room["id"] / rec["filename"]
    if not filepath.exists():
        raise HTTPException(status_code=410, detail="File missing on disk")
    return FileResponse(
        path=str(filepath),
        media_type=rec.get("mime_type", "application/octet-stream"),
        filename=rec["filename"],
    )


@router.delete("/{recording_id}", status_code=204)
async def delete_recording(recording_id: str, user: dict = Depends(admin_only)):
    db = get_db()
    room = await _my_room(db, user)
    rec = await db.recordings.find_one({"id": recording_id})
    if not rec or rec.get("room_id") != room["id"]:
        raise HTTPException(status_code=404, detail="Recording not found")
    try:
        (RECORDINGS_DIR / room["id"] / rec["filename"]).unlink()
    except Exception:
        pass
    await db.recordings.delete_one({"id": recording_id})
    return None
