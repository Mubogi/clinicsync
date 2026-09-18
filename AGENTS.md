# AGENTS.md — ClinicSync

Offline-first pharmacy/clinic management PWA. React + Vite client, Express +
Prisma (Postgres) server. Server also serves the built client from
`client/dist`, so one process on port 12000 is the whole app.

## Commands

```bash
npm run build -w client      # build the SPA into client/dist
npm run dev -w server        # API (and client if built)
npm run setup -w server      # prisma migrate + seed demo data
```

Run the server on the port the runtime expects:

```bash
cd server && PORT=12000 node src/index.js > /tmp/srv.log 2>&1 &
```

A bare `node src/index.js` defaults to port 5000 and the preview URL will 502.

## Layout

- `server/src/plans.js` — single source of truth for tiers, limits and pricing.
  Mirrored in `client/src/lib/utils.js`; change both together.
- `server/src/routes/billing.js` — public pricing/quote plus owner payment claims.
- `server/src/routes/admin.js` — platform admin console API (claims, activate,
  suspend). Gated by `SYS_ADMIN_IDS` and fails closed when unset.
- `client/src/pages/Landing.jsx`, `Signup.jsx`, `Billing.jsx`, `Admin.jsx`.

## Conventions

- Money is UGX, integers only, rendered with `toLocaleString("en-UG")`.
- Tier gating is always enforced server-side; the client UI only reflects what
  `getEffectiveTier()` in `server/src/plans.js` returns. Never trust a
  client-declared tier or `facilityId` — both are derived from the JWT.
- Every clinic query must be scoped by `facilityId` from `req.user`.

## Gotchas

- `SYS_ADMIN_IDS` must list real user ids; the seeded demo owner is
  `demo-user-owner`. Empty means nobody is a platform admin.
- Demo PIN hints on the login page render only when `import.meta.env.DEV` or
  `VITE_SHOW_DEMO_LOGINS=1`, so seeded credentials stay out of production bundles.
- `.env` files and `server/prisma/*.db` are gitignored. Never commit them.

## Deploying to Render

`render.yaml` is the blueprint: one web service that serves both the API and
`client/dist`, plus a managed Postgres. The Node process serves the built client
itself, so there is no second static site and no cross-origin setup — leave
`VITE_API_URL=/api` and leave `CORS_ORIGINS` alone.

Set these in the Render dashboard, not in the repo:

- `JWT_SECRET` — **required**. `server/src/config.js` refuses to boot with
  `NODE_ENV=production` if it is missing or shorter than 32 chars, because a
  guessable key lets anyone forge an owner token for any facility.
  Generate with `openssl rand -hex 32`.
- `SYS_ADMIN_IDS` — the user id(s) allowed to open `/admin`. Read it from
  `/api/auth/me` after signing in. Empty disables the admin console entirely.

Deploy command notes:

- Build: `npm install --workspaces && npm run build -w client && npx prisma generate`.
- Start: `npx prisma migrate deploy && npm start`. `migrate deploy` applies the
  committed migrations; never use `migrate dev` in production — it can prompt or
  reset data.
- `npm start` respects `PORT`, which Render injects. Do not hardcode 5000.

`prisma/seed.js` refuses to run under `NODE_ENV=production` unless
`SEED_ALLOW_IN_PRODUCTION=1` and real `SEED_OWNER_PIN` / `SEED_OWNER_PASSWORD`
values are supplied, so a stray seed cannot plant the publicly-known demo owner
in a live database. Real clinics self-register through `/signup` instead.

## Pushing

`main` on `github.com/Mubogi/clinicsync` is the source of truth; `origin/main`
was at `07fd476` before the paid-BASIC work landed on top of it. Push with an
account that has write access to `Mubogi/clinicsync` — the default
`GITHUB_TOKEN` in this environment authenticates as `Arnoldmula`, which only has
read access and will fail with HTTP 403.
