# ClinicSync

> Offline-first hospital, clinic & drug shop management system for low-resource environments. POS, quick cash receipts, daily expenses, end-of-day cash reconciliation, inventory with FEFO batch expiry, and tiered SaaS (Basic / Premium / Pro.

Built by **Jordan Design Hub (JD Hub) — Mubogi Gastavas Jordan Tech Ecosystem** · jordandesignhub@gmail.com · WhatsApp +256 754 687 597 · Uganda

## What it does

ClinicSync runs **offline-first**: all reads/writes hit the browser's local database (IndexedDB via PouchDB)**first**, and a background **sync worker** pushes changes to the cloud the moment connectivity returns. That means a rural drug shop with patchy internet keeps selling, logging expenses, and closing the day's books even when the network is down — no lockout, no data loss.

.

### Core modules

| Module | Description |
|---|---|
| 🛒 **POS & Quick Cash Receipts** | Fast drug search by name/brand/category; sell by tablet / strip-of-10 / full box with automatic unit-price math; one-tap quick-adds (Paracetamol, Amoxicillin, Metronidazole); auto-incrementing receipt numbers (#2429, #2430…; printable 80mm thermal-receipt layout via `@media print`. |
| 💸 **Daily Expenses Tracker** | Log operating costs (YAKA/electricity, water, staff allowances, transport, packaging) with pre-filled categories; cash expenses immediately deduct from the current shift cash balance. |
| 📊 **End-of-Day Balance Sheet** | One-click reconciliation: gross revenue, total expenses, MTN/Airtel mobile-money received separately, expected cash at hand (cash revenue − cash expenses), wholesale restock spend ("Drugs Bought")); lock-shift button finalizes the books. |
| 📦 **Inventory & Reorder** | Stock levels per unit type; FEFO (First-Expire-First-Out) batch expiry management; reorder-level alerts (Premium+. |
| ☁️ **Offline-First Sync** | PouchDB local-first writes with `sync_status` flags; delta sync worker pushes unsynced rows and pulls cloud updates when online; Last-Write-Wins conflict handling. |
| 👥 **Tiered SaaS** | Basic: single-counter POS + manual daily sync + expense log. Premium: continuous auto-sync + reorder alerts + FEFO batch expiry. Pro: remote multi-branch owner portal + advanced financial audits. |
| 🖥️ **Remote Owner Portal** | Pro-tier dashboard for owners to log in from any PC/phone and view synced real-time performance across branches. |

## Tech stack

| Layer | Tech |
|---|---|
| Backend | Node.js · Express · Prisma ORM · PostgreSQL (Supabase/Neon-compatible) |
| Frontend | React · Vite · Tailwind CSS · Lucide React · PouchDB (IndexedDB offline store) |
| Auth | PIN-based cashier login + JWT sessions |
| Deploy | Docker Compose (local Postgres)); Vite/Express deployable to Railway/Render/Supabase+Neon |

## Getting started

```bash
npm install:all (or: npm install)
cp .env.example .env          # tweak DATABASE_URL/JWT_SECRET
docker compose up -d db       # local Postgres (or point DATABASE_URL at Supabase/Neon
npm run setup -w server        # prisma migrate + seed demo facility/user
npm run dev                    # server: http://localhost:5000 · client: http://localhost:5173
```

Default demo login (seeded):
- **PIN:** `1234` · Role: `OWNER` · Facility: `Mubogi Pharmacy (Demo)`

## Project profile

See [`PROJECT_PROFILE.md`](PROJECT_PROFILE.md) — same structure as every JD Hub project per the [Mubogi Ecosystem](https://github.com/Mubogi/mubogi-ecosystem).

---
*ClinicSync · JD Hub project · Template version: 1.0*