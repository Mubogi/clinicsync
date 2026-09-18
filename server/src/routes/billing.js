import { Router } from "express";
import rateLimit from "express-rate-limit";

import { prisma } from "../db.js";
import { requireAuth, requireRole, serializeFacility } from "../auth.js";
import { TIERS, getEffectiveTier, tierPrice, GRACE_DAYS, TRIAL_DAYS } from "../plans.js";
import { serverError, cleanString } from "../http.js";
import { COLLECTION } from "../config.js";

const router = Router();

// Someone hammering the till endpoint could clog the admin queue with junk
// claims, each of which an operator then has to read and reject by hand.
const claimLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many payment submissions. Please contact us on WhatsApp." },
});

// Public: where to send money. Shown on the pricing page before sign-in, so it
// must not require auth. Contains only the collection till and payee name —
// deliberately no credentials or internal billing configuration.
router.get("/config", (_req, res) => {
  res.json({
    payeeName: COLLECTION.payeeName,
    airtel: { name: COLLECTION.airtelName, number: COLLECTION.airtelNumber },
    mtn: { name: COLLECTION.mtnName, number: COLLECTION.mtnNumber },
    whatsapp: COLLECTION.whatsapp,
    instructions: [
      `Dial the ${COLLECTION.networkLabel} menu and send the exact amount to ${COLLECTION.airtelNumber} (${COLLECTION.airtelName}).`,
      "Keep the transaction ID (SMS confirmation) — you will need to type it below.",
      "Submit this form with that transaction ID.",
      "We verify it at the till and activate your plan — usually within a few hours.",
    ],
    graceDays: GRACE_DAYS,
    trialDays: TRIAL_DAYS,
  });
});

// Priced quote for a tier/term, so the client never does money arithmetic of
// its own and cannot disagree with what the server charges.
router.get("/quote", (req, res) => {
  const tier = String(req.query.tier || "BASIC").toUpperCase();
  const months = Math.max(1, Math.min(24, parseInt(req.query.months, 10) || 1));
  if (!TIERS[tier]) return res.status(400).json({ error: "Unknown plan" });
  res.json({ tier, months, amountUgx: tierPrice(tier, months), monthlyUgx: TIERS[tier].priceUgx });
});

// Owner submits proof of payment for a plan.
//
// This only records a claim — it grants nothing. The subscription is activated
// solely by an admin approving the row, which is what stops anyone from
// upgrading themselves to PRO by posting a made-up transaction ID.
router.post("/payment-requests", requireAuth, requireRole("OWNER"), claimLimiter, async (req, res) => {
  try {
    const tier = String(req.body?.requestedTier || "").toUpperCase();
    const months = Math.max(1, Math.min(24, parseInt(req.body?.months, 10) || 1));
    const transactionRef = cleanString(req.body?.transactionRef, 64);
    const method = String(req.body?.method || "AIRTEL").toUpperCase() === "MTN" ? "MTN" : "AIRTEL";
    const payerName = cleanString(req.body?.payerName, 120);
    const payerPhone = cleanString(req.body?.payerPhone, 32);
    const note = cleanString(req.body?.note, 500);

    if (!TIERS[tier]) return res.status(400).json({ error: "Choose a valid plan." });
    if (!transactionRef || transactionRef.length < 4) {
      return res.status(400).json({ error: "Enter the transaction ID from your confirmation SMS." });
    }

    const existing = await prisma.paymentRequest.findFirst({
      where: { facilityId: req.user.facilityId, status: "PENDING" },
    });
    if (existing) {
      return res.status(409).json({
        error: "You already have a payment awaiting confirmation. We will activate your plan shortly.",
        paymentRequest: existing,
      });
    }

    const created = await prisma.paymentRequest.create({
      data: {
        facilityId: req.user.facilityId,
        requestedTier: tier,
        months,
        amountUgx: tierPrice(tier, months),
        method,
        payerName,
        payerPhone,
        transactionRef,
        note,
      },
    });
    res.status(201).json(created);
  } catch (err) {
    serverError(res, err);
  }
});

// Owner's own submission history, so they can see pending/approved/rejected
// without asking support.
router.get("/payment-requests", requireAuth, requireRole("OWNER"), async (req, res) => {
  try {
    const rows = await prisma.paymentRequest.findMany({
      where: { facilityId: req.user.facilityId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(rows);
  } catch (err) {
    serverError(res, err);
  }
});

// Owner's billing status: what plan, when it ends, whether it has lapsed.
router.get("/status", requireAuth, async (req, res) => {
  try {
    const facility = await prisma.facility.findUnique({ where: { id: req.user.facilityId } });
    if (!facility) return res.status(404).json({ error: "Clinic not found" });
    const effective = getEffectiveTier(facility);
    res.json({
      effectiveTier: effective.key,
      storedTier: effective.storedTier,
      expired: !!effective.expired,
      onTrial: !!effective.onTrial,
      suspended: !!facility.suspended,
      readOnly: !!effective.readOnly,
      subscriptionEndsAt: facility.subscriptionEndsAt,
      trialEndsAt: facility.trialEndsAt,
      facility: serializeFacility(facility),
    });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
