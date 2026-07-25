# TalkNet — Product Requirements Document

## Original Problem Statement
Build a production-ready browser-based audio conferencing platform using React + TypeScript, NestJS, PostgreSQL, Prisma, LiveKit, Docker, and Tailwind CSS. Do not generate the entire project at once. Build it in phases.

## Adapted Stack (agreed with user)
- Frontend: React (JS) + Tailwind + Shadcn UI + LiveKit client
- Backend: FastAPI (Python) + Motor (MongoDB)
- Real-time audio: LiveKit Cloud
- Auth: Custom JWT (Bearer tokens)

## Business Model (given by user)
- **Platform Owner** creates **Customers**.
- Each Customer gets **one Room Admin**.
- Each Room Admin manages **one Room** with **10–15 Users**.
- Everyone communicates via **Push-to-Talk (PTT)**.
- Recordings are stored securely (deferred to Phase 2).
- Architecture is multi-tenant and scales 2–3 → 50+ customers with no core changes.

## User Personas
1. **Platform Owner** — SaaS operator. Onboards customers, suspends misbehaving ones.
2. **Room Admin** — Customer's manager. Adds/removes room members, hosts audio room (mute/kick).
3. **User** — End-listener/talker in the room. PTT-only.

## Core Data Model (MongoDB)
- `users` { id, email, password_hash, name, role, customer_id, status, created_at }
  - role ∈ platform_owner | room_admin | user
- `customers` { id, name, admin_user_id, room_id, status, created_at }
- `rooms` { id, customer_id, name, room_code, livekit_room_name, max_participants, created_at }

## Phase 1 (DONE — 2026-02-09)
- JWT auth (login/me/logout, Bearer tokens)
- Platform Owner seed from .env on startup
- Platform Console: list/create/suspend/delete customers, live stats
- Room Admin Console: view own room, share room code, add/remove members (cap 15), enter room
- Audio Room: LiveKit connection, Push-to-Talk (Space bar + on-screen button), speaking indicators, host controls (server-enforced mute/kick via LiveKit server API)
- Multi-tenant isolation: every API check derives room from `user.customer_id`
- Design: Swiss-brutalist minimal (Manrope/IBM Plex Sans, sage green #3A4F41)

## Phase 3 refactor (DONE — 2026-02-09) — 3-role model
- **Removed the Customer tenant layer entirely.** Model is now Platform Owner → Room Admin → Users. `customers` collection dropped on startup migration.
- `rooms` now carries `admin_user_id` (unique) + `status`; `users` now carries `room_id`.
- **Room Admin restrictions**: cannot create rooms, cannot see/modify any room but their assigned one. `/api/admin/rooms` removed; `/api/admin/room` returns the single assigned room.
- Platform Owner endpoint moved: `POST /api/platform/rooms` provisions a room + its admin in one atomic call (room inserted first, admin second, admin rollback on failure).
- Frontend: Owner console renamed to "Rooms" with new provision dialog. Admin dashboard shows exactly one room card (no list, no create). User picker (`/rooms`) auto-forwards to their one assigned room.
- Startup migration is idempotent: preserves existing data by finding one canonical room per legacy customer's admin, backfilling `room_id` on users, unset `customer_id`, backfilling missing `status`.
- 17/17 backend tests pass in `/app/backend/tests/test_talknet_v3.py`; frontend flows verified.
- **Suspended-user runtime enforcement** — `get_current_user` returns 403 on every request if `user.status == "suspended"` (instant lockout after platform owner suspends).
- **Password reset** — `/auth/forgot-password` (privacy-preserving 200) + `/auth/reset-password` with TTL-indexed token. Reset link printed to backend log until Resend key is added.
- **Multi-room per customer** — admin can create up to 20 rooms with `/api/admin/rooms` CRUD; last-room protection; each with its own room_code. Users pick a room from `/rooms` before joining.
- **Session analytics** — `/api/room/session/{start,end}` + `/api/platform/analytics` (daily minutes, top customers). LineChart on Owner console.
- **Brute-force lockout** — 5 failed logins per (client_ip, email) → 429 for 15 min. Uses `X-Forwarded-For` (fixed after first test iteration flagged pod-IP bug).
- **Polish** — shadcn AlertDialog for every destructive action (customer delete, room delete, member remove, kick participant) with dedicated `*-confirm-button` test-ids.

## Phase 3 (BACKLOG — P2)
- LiveKit Egress recordings → object storage (S3 or Emergent object storage)
- Email invites & delivery via Resend (needs API key)
- Superadmin analytics dashboard (usage minutes per customer over time — infra ready, needs viz upgrade)
- Per-seat billing (Stripe)
- Mobile PWA + hardware PTT key
- Store `sessions.joined_at` as BSON Date for type-safe range queries

## Setup Notes
- `.env` (backend): `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `OWNER_EMAIL`, `OWNER_PASSWORD`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- Currently LiveKit uses **placeholder credentials** → real audio will fail until user provides LiveKit Cloud keys. All other flows work.

## Next Action Items
- Provide real LiveKit Cloud credentials (URL, API Key, API Secret)
- Decide on recording storage backend for Phase 2
- Optionally connect Resend for password / invite emails

## Update 2026-02-XX — Plan capacity change
- **Plan A · Starter** — 10 PTT users / 1 room / $9/mo (was 5)
- **Plan B · Team** — 15 PTT users / 1 room / $19/mo (was 10)
- **Plan C · Broadcast** — 25 always-muted users / 1 room / $29/mo (admin grants mic on demand)
- All references pulled from central `PLANS` dict in `/app/backend/models.py`.
- Fixed hardcoded `/15` member counts in AdminDashboard to use `room.max_users` (now plan-aware).
- Wording refresh: "listener" / "listener-only" → "muted" / "always-muted" in Owner console + plan cards.

## Deployment fix 2026-02-XX
- `.gitignore` had `.env.*` blocking `.env.example` from being committed. Added explicit negation rules (`!.env.example`, `!.env.sample`, `!.env.template` at root and nested) so template files ship with the repo for VPS `docker compose` bootstrap.


## Update 2026-02-25 — Username-based user login (DONE)
- **Owner & Admin** still log in with email + password.
- **Room User** now logs in with **username + password** (no email needed). Admin sets the username when adding the user.
- Login endpoint accepts `{identifier, password}` — auto-detects email vs username by `@`.
- Username-lookup restricted to `role='user'` accounts (admins/owners can't be impersonated via a username collision).
- DB: `users.email` → unique+sparse; `users.username` → unique+sparse. On startup `migrate_users_to_username_login()` backfills existing role=user docs by deriving username from email prefix (dedupes with `-N` suffix).
- Validation: username regex `^[a-zA-Z0-9_.\-]+$`, length 3–40. Duplicate → 409.
- Frontend: single "Email or Username" input on LoginPage; AdminDashboard's Add-member modal replaced email with username field + pattern validation.
- Coverage: 13/13 pytest in `/app/backend/tests/test_username_auth.py`, all frontend flows verified by testing agent (100% pass).

## Update 2026-02-25 — Grid auto-scale (P0 DONE)
- Room page wrapper is now `h-screen ... overflow-hidden`. Zero page-level scrolling regardless of participant count.
- Grid uses dynamic `gridTemplateColumns: repeat(N, minmax(0,1fr))` where `N = min(6, ceil(√count))`, and `gridAutoRows: minmax(0,1fr)` so tiles fill available height evenly.
- Compact mode when >6 participants: smaller avatar/text and icon-only admin action buttons.
- Recent Speakers panel moved from a section below the grid → a Popover triggered from the header (admin only). Grid now owns the full viewport.
- PTT bar is a normal flex-footer (no longer sticky/pointer-events tricks).

