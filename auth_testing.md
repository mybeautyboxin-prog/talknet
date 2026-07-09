# Auth Testing Playbook — TalkNet

## Credentials
Platform owner (seeded):
- Email: `xpertcctv.delhi@gmail.com`
- Password: `love@2001`

## API tests (curl)

Login:
```
curl -X POST "$BACKEND/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"xpertcctv.delhi@gmail.com","password":"love@2001"}'
```
Expected: 200 with `{ token, user: { role: "platform_owner" } }`.

Me:
```
curl "$BACKEND/api/auth/me" -H "Authorization: Bearer <token>"
```

Invalid password → 401.
Suspended user → 403.

## Multi-tenant boundary tests
- Room admin from Customer A should get 403 when trying to access another customer's room.
- User with no `customer_id` → 400 on `/api/room/token`.

## Frontend flows
- Landing → click "Sign in" → login page
- Login as platform owner → redirected to `/platform`
- Login as room admin → redirected to `/admin`
- Login as user → redirected to `/room`
