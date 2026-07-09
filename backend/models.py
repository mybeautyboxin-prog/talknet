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
    customer_id: Optional[str] = None
    status: Status = "active"
    created_at: str


class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


# -------- Customer --------
class CustomerCreate(BaseModel):
    customer_name: str = Field(min_length=2, max_length=80)
    admin_name: str = Field(min_length=2, max_length=80)
    admin_email: EmailStr
    admin_password: str = Field(min_length=6, max_length=128)
    room_name: str = Field(min_length=2, max_length=80)


class CustomerPublic(BaseModel):
    id: str
    name: str
    status: Status
    created_at: str
    admin: Optional[UserPublic] = None
    room: Optional["RoomPublic"] = None
    member_count: int = 0


class CustomerStatusUpdate(BaseModel):
    status: Status


# -------- Room --------
class RoomPublic(BaseModel):
    id: str
    customer_id: str
    name: str
    room_code: str
    livekit_room_name: str
    max_participants: int = 15
    created_at: str


# -------- Room Members (Users under an admin) --------
class RoomMemberCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


# -------- LiveKit Token --------
class TokenResponse(BaseModel):
    token: str
    livekit_url: str
    room_name: str
    identity: str
    is_host: bool


# -------- Moderator actions --------
class ModeratorAction(BaseModel):
    identity: str  # participant identity to act on
    track_sid: Optional[str] = None  # required for mute


CustomerPublic.model_rebuild()
