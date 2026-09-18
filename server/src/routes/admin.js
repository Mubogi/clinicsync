import { Router } from "express";
import bcrypt from "bcryptjs";

import { prisma } from "../db.js";
import { requireAuth, serializeFacility } from "../auth.js";
import { TIERS, getEffectiveTier, daysRemaining, tierPrice } from "../plans.js";
import { SYS_ADMIN_IDS } from "../config.js";
import { serverError, cleanString } from "../http.js";

const router = Router();

// Platform-admin gate for managing *other* clinics. Fails closed: if no
// SYS_ADMIN_IDS are configured, nobody can list, create, retier or delete
// facilities they do not belong to. Without this, every facility owner on the
// server could read and wipe every other pharmacy's data.
const requireAdmin = (req, res, next) => {
  if (SYS_ADMIN_IDS.length === 0) {
    return res.status(403).json({
      error:
        "Platform administration is not enabled on this server. Set SYS_ADMIN_IDS to grant it.",
    });
  }
  if (!SYS_ADMIN_IDS.includes(req.user.sub)) {
    return res.status(403).json({ error: "Platform admin access required" });
  }
  next();
};

// Every privileged action is recorded. Audit writes must never break the action
// itself, so failures are logged and swallowed rather than surfaced.
async function audit(req, action, { facilityId = null, targetId = null, detail = null, meta = null } = {}) {
  try {
    await prisma.adminAudit.create({
      data: {
        actorId: req.user.sub,
        actorName: req.user.name || req.user.email || null,
        action,
        facilityId,
        targetId,
        detail,
        meta: meta || undefined,
      },
    });
  } catch (err) {
    console.error("[clinicsync] audit write failed:", err?.message);
  }
}

function addMonths(from, months) {
  // Month-stepping on the calendar, so "1 month" from Jan 31 lands in Feb
  // rather than 30 days later.
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

// List all clinics/pharmacies on the server (platform-admin only)
router.get("/facilities", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const facilities = await prisma.facility.findMany({
      include: { _count: { select: { users: true, sales: true, inventories: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(
      facilities.map((f) => {
        const effective = getEffectiveTier(f);
        return {
          ...serializeFacility(f),
          userCount: f._count.users,
          saleCount: f._count.sales,
          inventoryCount: f._count.inventories,
          // Billing view for the operator: what was granted vs what the clinic
          // can actually use right now.
          storedTier: effective.storedTier,
          effectiveTier: effective.key,
          expired: !!effective.expired,
          suspended: !!f.suspended,
          suspendedReason: f.suspendedReason,
          subscriptionEndsAt: f.subscriptionEndsAt,
          daysRemaining: daysRemaining(f),
          monthlyValueUgx: TIERS[effective.storedTier]?.priceUgx || 0,
        };
      })
    );
  } catch (err) {
    serverError(res, err);
  }
});

// Activate or renew a clinic's paid plan for N months.
//
// This is the only place a paid tier is granted. It extends from the later of
// "now" and the current period end, so renewing early adds time instead of
// discarding the remainder the clinic already paid for.
router.post("/facilities/:id/subscription", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { tier, months = 1, note } = req.body;

    if (!TIERS[tier]) {
      return res.status(400).json({ error: "Unknown plan" });
    }
    const m = Number(months);
    if (!Number.isInteger(m) || m < 1 || m > 36) {
      return res.status(400).json({ error: "months must be a whole number between 1 and 36" });
    }
    // Default to the catalogue price rather than 0. BASIC is now a paid tier, so
    // an omitted amount previously meant a free month recorded as a payment —
    // silently under-reporting revenue and hiding a billing mistake.
    const amount = req.body.amountUgx == null ? tierPrice(tier, m) : Number(req.body.amountUgx);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: "amountUgx must be a non-negative number" });
    }

    const facility = await prisma.facility.findUnique({ where: { id } });
    if (!facility) return res.status(404).json({ error: "Not found" });

    const now = new Date();
    // Same rule as claim approval: extend from the furthest point already paid
    // for (paid period or remaining trial), so granting early never burns days.
    const paidUntil = facility.subscriptionEndsAt && facility.subscriptionEndsAt > now
      ? facility.subscriptionEndsAt
      : null;
    const trialUntil = facility.trialEndsAt && facility.trialEndsAt > now
      ? facility.trialEndsAt
      : null;
    const base = [paidUntil, trialUntil].filter(Boolean).sort((a, b) => b - a)[0] || now;
    const periodEnd = addMonths(base, m);

    const [updated, payment] = await prisma.$transaction([
      prisma.facility.update({
        where: { id },
        data: {
          subscriptionTier: tier,
          subscriptionEndsAt: periodEnd,
          suspended: false,
          suspendedReason: null,
        },
      }),
      prisma.payment.create({
        data: {
          facilityId: id,
          tier,
          months: m,
          amountUgx: Math.round(amount),
          note: cleanString(note, 240) || null,
          periodStart: base,
          periodEnd,
          recordedBy: req.user.sub,
        },
      }),
    ]);

    res.json({
      facility: serializeFacility(updated),
      subscriptionEndsAt: updated.subscriptionEndsAt,
      payment,
    });
    await audit(req, "SUBSCRIPTION_ACTIVATE", {
      facilityId: id,
      targetId: facility.id,
      detail: `${tier} for ${m} month(s), UGX ${Math.round(amount)}`,
      meta: { tier, months: m, amountUgx: Math.round(amount), periodEnd },
    });
  } catch (err) {
    serverError(res, err);
  }
});

// Suspend a clinic (cut off access without deleting data) or lift a suspension.
router.patch("/facilities/:id/suspension", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { suspended, reason } = req.body;
    if (typeof suspended !== "boolean") {
      return res.status(400).json({ error: "suspended must be true or false" });
    }
    const facility = await prisma.facility.update({
      where: { id: req.params.id },
      data: {
        suspended,
        suspendedReason: suspended ? cleanString(reason, 240) || "Suspended by operator" : null,
      },
    });
    res.json(serializeFacility(facility));
    await audit(req, suspended ? "SUSPEND" : "UNSUSPEND", {
      facilityId: facility.id,
      targetId: facility.id,
      detail: suspended ? facility.suspendedReason : "Suspension lifted",
    });
  } catch (err) {
    serverError(res, err);
  }
});

// List the staff of one clinic so the operator can act on an individual.
router.get("/facilities/:id/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { facilityId: req.params.id },
      select: { id: true, name: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(users);
  } catch (err) {
    serverError(res, err);
  }
});

// Deactivate or reactivate a single user across any clinic.
//
// requireAuth() re-checks `active` on every request, so a deactivated user is
// locked out immediately rather than when their token expires.
router.patch("/users/:id/active", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { active } = req.body;
    if (typeof active !== "boolean") {
      return res.status(400).json({ error: "active must be true or false" });
    }
    // Don't let the operator lock themselves out of their own console.
    if (req.params.id === req.user.sub) {
      return res.status(400).json({ error: "You cannot deactivate your own account" });
    }

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: "Not found" });

    // Never leave a clinic with no active owner to administer it.
    if (!active && target.role === "OWNER") {
      const otherOwners = await prisma.user.count({
        where: { facilityId: target.facilityId, role: "OWNER", active: true, id: { not: target.id } },
      });
      if (otherOwners === 0) {
        return res.status(400).json({
          error: "This is the clinic's only active owner. Deactivate the clinic instead.",
        });
      }
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { active },
      select: { id: true, name: true, role: true, active: true },
    });
    res.json(user);
    await audit(req, active ? "USER_ACTIVATE" : "USER_DEACTIVATE", {
      facilityId: target.facilityId,
      targetId: target.id,
      detail: `${target.name || target.id} (${target.role}) ${active ? "reactivated" : "deactivated"}`,
    });
  } catch (err) {
    serverError(res, err);
  }
});

// Billing history for one clinic.
router.get("/facilities/:id/payments", requireAuth, requireAdmin, async (req, res) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { facilityId: req.params.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({
      payments,
      totalUgx: payments.reduce((s, p) => s + p.amountUgx, 0),
    });
  } catch (err) {
    serverError(res, err);
  }
});

// Aggregate revenue view: what the platform is owed per month.
router.get("/overview", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const facilities = await prisma.facility.findMany();
    const now = Date.now();
    let activePaying = 0;
    let lapsed = 0;
    let trial = 0;
    let mrrUgx = 0;
    for (const f of facilities) {
      const eff = getEffectiveTier(f);
      if (eff.onTrial) trial += 1;
      if (eff.readOnly) {
        lapsed += 1;
        continue;
      }
      // Every tier is billable now, so BASIC counts toward MRR too — the old
      // `if (stored === "BASIC") continue` skipped it as a free plan and would
      // understate revenue by every entry-level clinic.
      activePaying += 1;
      mrrUgx += TIERS[eff.storedTier]?.priceUgx || 0;
    }
    const [pendingRequests, collectedAgg] = await Promise.all([
      prisma.paymentRequest.count({ where: { status: "PENDING" } }),
      prisma.payment.aggregate({ _sum: { amountUgx: true } }),
    ]);
    res.json({
      facilityCount: facilities.length,
      activePaying,
      lapsed,
      trial,
      pendingRequests,
      mrrUgx,
      collectedUgx: collectedAgg._sum.amountUgx || 0,
      generatedAt: new Date(now).toISOString(),
    });
  } catch (err) {
    serverError(res, err);
  }
});

// Payment claims awaiting verification, oldest first so nobody is left waiting
// behind a queue of newer submissions.
router.get("/payment-requests", requireAuth, requireAdmin, async (req, res) => {
  try {
    const status = String(req.query.status || "PENDING").toUpperCase();
    const where = ["PENDING", "APPROVED", "REJECTED"].includes(status) ? { status } : {};
    const rows = await prisma.paymentRequest.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: 200,
      include: { facility: { select: { id: true, name: true, phone: true, email: true } } },
    });
    res.json(rows);
  } catch (err) {
    serverError(res, err);
  }
});

// Approve a claimed payment: this is the step that actually starts the paid
// period. Approving reuses the same period-extension logic as a manual grant, so
// a clinic that renews early keeps its remaining days instead of losing them.
router.post("/payment-requests/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  try {
    const claim = await prisma.paymentRequest.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ error: "Payment request not found" });
    if (claim.status !== "PENDING") {
      return res.status(409).json({ error: `This request was already ${claim.status.toLowerCase()}.` });
    }

    const facility = await prisma.facility.findUnique({ where: { id: claim.facilityId } });
    if (!facility) return res.status(404).json({ error: "Clinic not found" });

    const now = new Date();
    // Extend from the furthest point the clinic has already paid for: an active
    // paid period, else remaining trial days, else today. Ignoring the trial
    // would silently burn the free days a clinic still had left.
    const paidUntil = facility.subscriptionEndsAt && facility.subscriptionEndsAt > now
      ? facility.subscriptionEndsAt
      : null;
    const trialUntil = facility.trialEndsAt && facility.trialEndsAt > now
      ? facility.trialEndsAt
      : null;
    const base = [paidUntil, trialUntil].filter(Boolean).sort((a, b) => b - a)[0] || now;
    const periodEnd = addMonths(base, claim.months);
    const amount = claim.amountUgx || tierPrice(claim.requestedTier, claim.months);

    const [updated, payment, request] = await prisma.$transaction([
      prisma.facility.update({
        where: { id: facility.id },
        data: {
          subscriptionTier: claim.requestedTier,
          subscriptionEndsAt: periodEnd,
          trialEndsAt: null,
          suspended: false,
          suspendedReason: null,
        },
      }),
      prisma.payment.create({
        data: {
          facilityId: facility.id,
          tier: claim.requestedTier,
          months: claim.months,
          amountUgx: amount,
          note: `Verified ${claim.method} txn ${claim.transactionRef}`,
          periodStart: base,
          periodEnd,
          recordedBy: req.user.sub,
        },
      }),
      prisma.paymentRequest.update({
        where: { id: claim.id },
        data: { status: "APPROVED", reviewedBy: req.user.sub, reviewedAt: now },
      }),
    ]);

    res.json({ facility: serializeFacility(updated), payment, request });
    await audit(req, "PAYMENT_APPROVE", {
      facilityId: facility.id,
      targetId: claim.id,
      detail: `${claim.requestedTier} ${claim.months}mo, ${claim.method} ${claim.transactionRef}, UGX ${amount}`,
    });
  } catch (err) {
    serverError(res, err);
  }
});

// Reject a claim that cannot be matched against the till statement. The clinic
// keeps working if its subscription is otherwise valid, so a typo in a
// transaction ID is not treated as non-payment.
router.post("/payment-requests/:id/reject", requireAuth, requireAdmin, async (req, res) => {
  try {
    const reason = cleanString(req.body?.reason, 240);
    if (!reason) return res.status(400).json({ error: "A reason is required so the clinic can be told why." });

    const claim = await prisma.paymentRequest.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ error: "Payment request not found" });
    if (claim.status !== "PENDING") {
      return res.status(409).json({ error: `This request was already ${claim.status.toLowerCase()}.` });
    }

    const request = await prisma.paymentRequest.update({
      where: { id: claim.id },
      data: {
        status: "REJECTED",
        reviewedBy: req.user.sub,
        reviewedAt: new Date(),
        rejectionReason: reason,
      },
    });
    res.json(request);
    await audit(req, "PAYMENT_REJECT", {
      facilityId: claim.facilityId,
      targetId: claim.id,
      detail: reason,
    });
  } catch (err) {
    serverError(res, err);
  }
});

// Create a new clinic/ pharmacy facility (multi-tenant onboarding)
router.post("/facilities", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, slug, subscriptionTier, ownerName, ownerPin, brandName } = req.body;
    if (!name || !ownerName || !ownerPin) {
      return res.status(400).json({ error: "name, ownerName and ownerPin required" });
    }
    const tier = TIERS[subscriptionTier] ? subscriptionTier : "BASIC";
    const facility = await prisma.facility.create({
      data: {
        name,
        slug: slug || null,
        subscriptionTier: tier,
        brandName: brandName || name,
        onboarded: false, // new clinics go through the first-time setup wizard
        users: {
          create: {
            name: ownerName,
            role: "OWNER",
            pinCode: bcrypt.hashSync(String(ownerPin), 10),
          },
        },
      },
    });
    const fresh = await prisma.facility.findUnique({
      where: { id: facility.id },
      include: { users: true },
    });
    res.status(201).json({
      facility: serializeFacility(fresh),
      owner: { id: fresh.users[0].id, name: fresh.users[0].name, role: fresh.users[0].role },
    });
  } catch (err) {
    serverError(res, err);
  }
});

// Update a clinic's subscription (paywall: change tier)
router.patch("/facilities/:id/tier", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { subscriptionTier } = req.body;
    if (!TIERS[subscriptionTier]) {
      return res.status(400).json({ error: "Invalid tier" });
    }
    const facility = await prisma.facility.update({
      where: { id: req.params.id },
      data: { subscriptionTier },
    });
    res.json(serializeFacility(facility));
    await audit(req, "TIER_CHANGE", {
      facilityId: facility.id,
      targetId: facility.id,
      detail: `tier set to ${subscriptionTier}`,
      meta: { subscriptionTier },
    });
  } catch (err) {
    serverError(res, err);
  }
});

// Delete a clinic (hard delete; used for onboarding trial cleanup)
router.delete("/facilities/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const f = await prisma.facility.findUnique({ where: { id } });
    if (!f) return res.status(404).json({ error: "Not found" });
    // Record the deletion before the facility row disappears; the audit entry is
    // deliberately not scoped by foreign key so it survives the cascade.
    await audit(req, "FACILITY_DELETE", {
      facilityId: id,
      targetId: id,
      detail: `deleted clinic "${f.name}"`,
      meta: { name: f.name, slug: f.slug },
    });
    // cascade manually: movement->inventory->saleitem->sale->user->... (simple approach: delete deepest first)
    await prisma.$transaction([
      prisma.priceHistory.deleteMany({ where: { facilityId: id } }),
      prisma.rememberToken.deleteMany({ where: { facilityId: id } }),
      prisma.dailyReconciliation.deleteMany({ where: { facilityId: id } }),
      prisma.expense.deleteMany({ where: { facilityId: id } }),
      // Staff invites, stored backups and pending delete requests hold a foreign
      // key to the facility; leaving them behind blocks the final delete.
      prisma.facilityInvite.deleteMany({ where: { facilityId: id } }),
      prisma.backup.deleteMany({ where: { facilityId: id } }),
      prisma.deleteRequest.deleteMany({ where: { facilityId: id } }),
      prisma.user.deleteMany({ where: { facilityId: id } }),
    ]);
    // remaining children: sale->saleitem, inventory->stockmovement
    const sales = await prisma.sale.findMany({ where: { facilityId: id }, select: { id: true } });
    await prisma.saleItem.deleteMany({ where: { saleId: { in: sales.map((s) => s.id) } } });
    await prisma.sale.deleteMany({ where: { facilityId: id } });
    const invs = await prisma.inventory.findMany({ where: { facilityId: id }, select: { id: true } });
    await prisma.stockMovement.deleteMany({ where: { inventoryId: { in: invs.map((i) => i.id) } } });
    await prisma.inventory.deleteMany({ where: { facilityId: id } });
    await prisma.product.deleteMany({ where: { facilityId: id } });
    // Billing records reference the facility too; they go last so the audit
    // entry above remains the permanent record of the clinic's history.
    await prisma.payment.deleteMany({ where: { facilityId: id } });
    await prisma.facility.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err);
  }
});

// Read back the platform-admin audit trail. Newest first; optionally scoped to
// one clinic.
router.get("/audit", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { facilityId } = req.query;
    const entries = await prisma.adminAudit.findMany({
      where: facilityId ? { facilityId: String(facilityId) } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(entries);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;