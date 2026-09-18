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

## Known blocker

Pushing to `github.com/Mubogi/clinicsync` fails with HTTP 403: the available
`GITHUB_TOKEN` authenticates as `Arnoldmula`, which has read-only (`pull`)
access to that repo. A push requires a token/account with write access, or the
repo owner pulling the prepared patch at `/workspace/clinicsync-paid-basic.patch`.
