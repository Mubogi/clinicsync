# ClinicSync — Delivery & Operations Runbook

How to run ClinicSync, sell it, and control who gets which tier.

## 1. Publish the admin-panel commits

Two commits already exist locally in `/tmp/csync-clone` (branch
`polish-print-pdf-ui`). The GitHub token available in this environment belongs
to `Arnoldmula`, which has **read-only** access to `Mubogi/clinicsync`, so the
push must be done by an account with write access to that repo.

An applyable patch is bundled here for that purpose:

```bash
cd /path/to/clinicsync
git checkout polish-print-pdf-ui      # or main
git am /workspace/clinicsync-admin-panel.patch
git push
```

Commits included:

- `ba63b50` Admin panel: activate/extend plans, suspend clinics, auto expiry
- `9e67565` Admin panel: deactivate/reactivate individual users

Alternatively, run the commands from a machine already authenticated as
`Mubogi`:

```bash
git clone https://github.com/Mubogi/clinicsync.git
cd clinicsync
git checkout polish-print-pdf-ui
git am /workspace/clinicsync-admin-panel.patch
git push origin polish-print-pdf-ui
```

## 2. Run the server

```bash
cp .env.example .env          # then edit
openssl rand -hex 32          # paste into JWT_SECRET
npm install
npx prisma migrate deploy
npm run build                 # builds the client
npm start                     # serves API + built client
```

Required environment variables:

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | Signs session tokens. Must be >= 32 chars in production or the server refuses to boot. |
| `DATABASE_URL` | Postgres connection string. |
| `SYS_ADMIN_IDS` | Comma-separated user IDs of platform operators. Empty means nobody is an admin. |
| `CORS_ORIGINS` | Comma-separated allowed web origins. |
| `BACKUP_RETENTION_DAYS` | How long server backups are kept. |

## 3. Create the platform operator

The admin console is gated by `SYS_ADMIN_IDS`, not by a role in the database.
The operator is an ordinary owner account whose user ID is listed there.

```bash
# 1. Register (or pick an existing owner) and note the user's id
# 2. Add it to .env
SYS_ADMIN_IDS=<user-id>

# 3. Restart, then open /admin
```

A good practice is to run one dedicated "ClinicSync Ops" facility whose owner
account is the operator. That account can then manage every clinic without
granting any pharmacy owner power over another.

## 4. Sell and activate

Pricing is defined in `server/src/plans.js`. Current tiers:

| Tier | Price | Users | Products | Facilities |
| --- | --- | --- | --- | --- |
| BASIC | UGX 0 | 1 | 50 | 1 |
| PREMIUM | UGX 25,000 / mo | 3 | 500 | 1 |
| PRO | UGX 75,000 / mo | 50 | unlimited | 50 |

The sales loop:

1. Clinic self-registers and lands on BASIC automatically. It cannot upgrade
   itself; paid tiers are requested, not granted.
2. Owner taps **Request upgrade** in Settings and pays by mobile money, cash,
   or bank transfer out of band.
3. Operator opens `/admin`, finds the clinic, clicks **Billing**, picks the
   tier and number of months, records the amount and a reference note, and
   clicks **Activate / extend**. The clinic has the tier immediately.

Renewals extend from the existing end date rather than replacing it, so a
clinic that pays early never loses the days it already paid for.

When a subscription lapses, the clinic drops to BASIC automatically after a
3-day grace window. Suspension is the harder stop: it locks the clinic out
immediately and shows the reason you type, which is what you want when a
payment bounces or terms are breached.

## 5. Delivery options for charging money

| Model | How it works | Trade-off |
| --- | --- | --- |
| Sell the hosted service | You run the server; clinics pay monthly per facility. | Recurring revenue, but you own uptime and support. |
| Sell to an operator | A distributor buys a PRO plan and resells to shops. | Fewer customers to support, thinner margin. |
| Sell the source once | One-time payment for the code, per-deployment. | No recurring revenue, no ongoing relationship. |
| Freemium funnel | Free BASIC forever, paid upgrade when they hit the seat or product cap. | Needs volume; the caps already do this work. |

The in-app gating is the enforcement mechanism for all four: BASIC's one-seat
and fifty-product limits are what make the upgrade worth paying for. Without a
payment processor wired in, collection is manual — which is normal for a
mobile-money market and is exactly what the admin console supports today.

Recommended next step for automation: **Flutterwave** or **Pesapal** for
mobile money (MTN/Airtel) plus card, with a webhook that calls the existing
`POST /admin/facilities/:id/activate` route on successful payment. That turns
manual activation into self-serve without changing the data model.

## 6. Security posture

Verified in this codebase, not assumed:

- **Tenant isolation.** Every clinic query is scoped by `facilityId` from the
  session, never from the request body. A live probe with a second clinic
  returned 404 on read, delete, and reprice of another clinic's product, 403 on
  the admin API, and saw zero foreign products.
- **Immediate revocation.** `requireAuth()` re-reads the user and facility on
  every request, so deactivation, demotion, and clinic suspension all take
  effect on the next call rather than when the 30-day token expires.
- **Admin gate fails closed.** With `SYS_ADMIN_IDS` unset, no account has
  platform powers. It is not a role a clinic can grant itself.
- **PIN storage.** PINs are bcrypt hashes (cost 10) and are never returned by
  the API.
- **Brute force.** Login is limited to 20 attempts per 15 minutes per IP, plus
  a blanket 300 req/min API limiter.
- **Signing key.** A weak or placeholder `JWT_SECRET` is rejected at boot in
  production, which prevents forged owner tokens for arbitrary facilities.
- **Payment/activation integrity.** Owners cannot reach admin routes, and the
  self-upgrade path was removed; only an operator can change a tier.

Known gaps to close before taking real money at scale:

1. **No automated backups off-host yet.** Backups are downloadable and stored
   on the server. Add an off-site copy (S3/B2) so a lost host is recoverable.
2. **Manual payments.** Collection is out of band until a gateway webhook is
   wired to the activation route.
3. **No TLS config in-repo.** Terminate TLS at a reverse proxy and set
   `CORS_ORIGINS` to the real domain, not localhost.
4. **`trust proxy` is fixed at 1.** Correct behind one proxy; revisit if the
   deployment adds another hop, since rate-limit keys derive from it.
5. **Audit trail is operational, not forensic.** Payment rows record amount and
   note, but there is no append-only log of every admin action.

## 7. Admin panel reference

`/admin` — requires `SYS_ADMIN_IDS`.

- **Overview tiles:** clinics, paying, lapsed, MRR, total collected.
- **Search:** filter clinics by name.
- **Billing:** per clinic — choose tier, months, amount, note, then Activate /
  extend. Shows payment history and lifetime collected.
- **Suspend / Reactivate:** with a reason the clinic sees on lockout.
- **Users:** list a clinic's staff and deactivate or reactivate any account.
  A clinic is never left without an active owner; deactivate the clinic
  instead. The operator cannot deactivate themselves.
