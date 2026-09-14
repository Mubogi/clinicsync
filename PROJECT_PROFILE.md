# Project Profile — ClinicSync

> Offline-first hospital, clinic & pharmacy management system for low-resource environments.

## 1. Business Overview
- **Owner / Brand:** Jordan Design Hub (JD Hub)— Mubogi Gastavas Jordan Tech Ecosystem
- **Contact:** jordandesignhub@gmail.com · WhatsApp +256 754 687 597
- **Category:** HealthTech / SME tools
- **Status:** MVP
- **Links:** Repo · Docs

## 2. Problem & Target Market
- **Problem:** Clinics, drug shops, and small hospitals in low-resource areas run on unreliable internet. Cloud-only POS/management systems lock staff out when the network drops, lose sales, and make end-of-day cash reconciliation manual and error-prone. Wholesale spend, mobile-money payments, and branch performance are scattered across notebooks.

- **Target users:** Drug shops, clinics, small hospitals, pharmacies, wholesale distributors (Uganda + wider East Africa)
- **Market context:** Uganda-specific: patchy connectivity, MTN/Airtel mobile money popularity, thermal-receipt POS culture, small-shop cash discipline.

##3. Value Proposition & Features
- Offline-first POS with one-tap quick-adds, multi-unit pricing (tablet/strip/box), auto receipt numbering, printable thermal receipts.

- Daily expenses tracker with pre-filled local categories (YAKA, transport, allowances, water, packaging)
- One-click End-of-Day balance sheet + cash reconciliation with MTN/Airtel split, drugs-bought tracking, lock-shift closing.

- Inventory with reorder alerts and FEFO batch expiry management.
.
- Background delta sync worker (push unsynced + pull cloud) with Last-Write-Wins conflict handling.
.
- Tiered SaaS: Basic (single counter), Premium (auto-sync + alerts + FEFO), Pro (remote multi-branch owner portal + financial audits.)
- Remote owner dashboard (log in from anywhere over PC/phone.

##4. Business / Monetization Model
- **Pricing:** freemium subscription
- **Revenue streams:** e.g. UGX 25,000–150,000/month per facility tier, setup/training fees, Pro multi-branch seats
- **Payment methods:** MTN MoMo, Airtel Money, Flutterwave

##5. Tech Stack
| Layer | Tech |
|-------|------|
| Backend | Node.js, Express, Prisma ORM |
| Frontend | React, Vite, Tailwind CSS, Lucide React, PouchDB |
| Database | PostgreSQL (Supabase/Neon-compatible), IndexedDB/PouchDB offline-first |
| Mobile/Desktop | Responsive PWA-ready web app (mobile bottom-nav, desktop sidebar)|
| Deploy | Docker Compose, Railway/Render/Supabase/Neon |

##6. Roadmap & Status
- **Current milestone:** MVP — working offline-first POS, expenses, EOD reconciliation, inventory, sync worker, tiered role views.
 - **Next steps:** PWA installability, FEFO batch-level expiry UI polish, multi-branch owner portal depth, real device thermal-printing tweaks, Supabase production seed.
 
- **Known gaps:** Receipt printing depends on browser print dialog; serverless-friendly PostgreSQL required for sync backend. 

##7. Metrics (optional)
- Facilities / shops: <number>
- Last updated: 2026-09-11

---
*Template version: 1.0 — kept identical across all JD Hub projects. Update only the content, not the structure.*