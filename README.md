# TalkNet — Production Deployment Guide

Browser-based multi-tenant Push-to-Talk audio conferencing platform.

**Stack (deployed):** React (nginx) + FastAPI + MongoDB + Redis + LiveKit Cloud, orchestrated with Docker Compose behind a single Nginx reverse proxy.

---

## 1. Prerequisites (single Ubuntu 24.04 VPS)

Minimum recommended: **2 vCPU, 4 GB RAM, 40 GB disk**.

```bash
# Install Docker + Compose plugin (official one-liner)
curl -fsSL https://get.docker.com | sudo sh
sudo apt install -y docker-compose-plugin
sudo usermod -aG docker $USER   # log out & back in

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable
```

Get:
- A domain pointed at your VPS's IPv4 (e.g. `talknet.example.com`)
- A **LiveKit Cloud** project → https://cloud.livekit.io → copy the URL / API key / secret

---

## 2. Clone & configure

```bash
git clone <your-repo-url> talknet && cd talknet
cp .env.example .env
$EDITOR .env       # fill in PUBLIC_BASE_URL, JWT_SECRET, OWNER_*, LIVEKIT_*
```

Generate a strong JWT secret:
```bash
openssl rand -hex 32
```

---

## 3. TLS (recommended — free with Let's Encrypt)

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d talknet.example.com
sudo mkdir -p ./certs
sudo cp /etc/letsencrypt/live/talknet.example.com/fullchain.pem ./certs/
sudo cp /etc/letsencrypt/live/talknet.example.com/privkey.pem   ./certs/
sudo chown -R $USER: ./certs
```

Then in `nginx.conf` uncomment the `listen 443 ssl` block + the HTTP→HTTPS redirect block, and set `HTTP_PORT=80 HTTPS_PORT=443` in `.env`.

Renew every 60 days: `sudo certbot renew && cp ...` (cron it).

---

## 4. Bring it up

```bash
docker compose --env-file .env up -d --build
docker compose ps
docker compose logs -f backend
```

First boot seeds the Platform Owner from `OWNER_EMAIL` / `OWNER_PASSWORD`.

Sign in at `${PUBLIC_BASE_URL}` and provision rooms + admins.

---

## 5. Services & ports

| Service    | Purpose                                    | Exposed to host |
|------------|--------------------------------------------|-----------------|
| `proxy`    | Nginx SPA + `/api` reverse proxy + TLS     | 80, 443         |
| `frontend` | Static React build served by nginx         | internal only   |
| `backend`  | FastAPI (`/api/*`)                         | internal only   |
| `mongo`    | Primary datastore                          | internal only   |
| `redis`    | Reserved (rate-limit, future queue)        | internal only   |
| `postgres` | Optional (commented — for future migration)| internal only   |
| LiveKit    | Cloud SaaS — outbound WSS from browsers    | n/a             |

The reverse proxy is the **only** service exposed publicly. All internal services live on the `talknet` private bridge network.

---

## 6. Common ops

```bash
# View logs
docker compose logs -f --tail=200 backend

# Restart one service
docker compose restart backend

# Update after `git pull`
docker compose up -d --build

# Snapshot Mongo
docker compose exec mongo mongodump --archive=/data/db/dump.gz --gzip

# Download composite recordings (webm)
docker compose cp backend:/app/recordings ./recordings-backup

# Wipe & start fresh (⚠ destroys all data)
docker compose down -v
```

---

## 7. Environment variables (see `.env.example`)

| Var                 | Description                                          |
|---------------------|------------------------------------------------------|
| `PUBLIC_BASE_URL`   | External URL end users hit (used for CORS, redirects, frontend build) |
| `HTTP_PORT`         | Host port for Nginx HTTP (default 80)               |
| `HTTPS_PORT`        | Host port for Nginx HTTPS (default 443)             |
| `DB_NAME`           | Mongo database name                                  |
| `JWT_SECRET`        | 64-hex random. **Change in every environment.**      |
| `OWNER_EMAIL/PASSWORD` | Seed platform-owner login on first boot          |
| `LIVEKIT_URL/API_KEY/API_SECRET` | LiveKit Cloud project keys              |
| `POSTGRES_*`        | Only if `postgres` service enabled                   |

**Nothing is hardcoded to `localhost`** in the runtime image — every URL comes from `.env`.

---

## 8. Scaling notes

- **Backend workers**: Dockerfile launches `uvicorn --workers 2`. Increase in `backend/Dockerfile` for higher throughput (`--workers 4` on 4+ vCPU).
- **Frontend**: static assets, near-zero cost.
- **MongoDB**: single-instance is fine to ~1 000 concurrent rooms. Beyond that, migrate to a replica set or a managed cluster (Atlas).
- **Recordings storage**: composite webm files live in the `recordings` named volume. For durability, swap to S3 by adding an S3 driver behind `POST /api/admin/recordings` (playbook in backlog).
- **LiveKit Cloud** handles all WebRTC media itself — the VPS never proxies audio bytes.

---

## 9. Original spec addendum — PostgreSQL

The initial requirements mentioned PostgreSQL + Prisma. The shipped implementation uses MongoDB (agreed during initial planning to match the Emergent environment). A `postgres` service is included in `docker-compose.yml` (commented) and can be turned on for future migration. The application layer would need to swap the Motor client for SQLAlchemy/Prisma — data model already sql-friendly (uuid primary keys, no nested collections).

---

## 10. Troubleshooting

**"Cannot GET /api/health"** → backend didn't start. `docker compose logs backend`. Common: bad `JWT_SECRET` (must be non-empty).

**"LiveKit not configured"** in the room screen → `LIVEKIT_URL` still points at the placeholder. Fix `.env` and `docker compose up -d`.

**Browser blocked microphone** → make sure the domain is on HTTPS. Chrome/Firefox block `getUserMedia` on plain http except `localhost`.

**429 rate-limited on login** → brute-force lockout kicked in. Wait 15 minutes or clear via:
```
docker compose exec mongo mongosh talknet --eval 'db.login_attempts.deleteMany({})'
```

**Cross-tab audio feedback while testing on one machine** → wear headphones or mute one tab.

---

## 11. Credits

Built on: FastAPI, React 19, LiveKit-client v2, Tailwind + shadcn/ui, MongoDB, Redis, Nginx. Container images: `python:3.11-slim`, `node:20-alpine`, `nginx:1.27-alpine`, `mongo:7`, `redis:7-alpine`.
