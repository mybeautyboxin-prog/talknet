from datetime import datetime, timezone
from typing import Optional, Literal
from pydantic import BaseModel, EmailStr, Field, ConfigDict
import uuid


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


Role = Literal["platform_owner", "room_admin", "user"]
Status = Literal["active", "suspended"]


# -------- User --------
class UserPublic(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: EmailStr
    name: str
    role: Role
    room_id: Optional[str] = None
    status: Status = "active"
    created_at: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=6, max_length=128)


# -------- Room --------
class RoomProvision(BaseModel):
    """Platform Owner provisions a room by supplying room details + its admin."""
    room_name: str = Field(min_length=2, max_length=80)
    admin_name: str = Field(min_length=2, max_length=80)
    admin_email: EmailStr
    admin_password: str = Field(min_length=6, max_length=128)


class RoomStatusUpdate(BaseModel):
    status: Status


class RoomPublic(BaseModel):
    id: str
    name: str
    room_code: str
    livekit_room_name: str
    max_participants: int = 15
    status: Status = "active"
    admin_user_id: Optional[str] = None
    admin: Optional[UserPublic] = None
    member_count: int = 0
    created_at: str


# -------- Members (Users under a Room Admin) --------
class RoomMemberCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


# -------- LiveKit --------
class RoomTokenRequest(BaseModel):
    room_id: str


class TokenResponse(BaseModel):
    token: str
    livekit_url: str
    room_name: str
    identity: str
    is_host: bool


class ModeratorAction(BaseModel):
    room_id: str
    identity: str
    track_sid: Optional[str] = None


# -------- Sessions / Analytics --------
class SessionStart(BaseModel):
    room_id: str


class SessionEnd(BaseModel):
    session_id: str
