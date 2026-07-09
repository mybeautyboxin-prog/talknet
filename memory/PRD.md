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

## Phase 2 (DONE — 2026-02-09)
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
