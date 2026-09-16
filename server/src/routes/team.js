import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";

import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { serverError, cleanString } from "../http.js";

const router = Router();

const randomToken = () => crypto.randomBytes(20).toString("hex");
const INVITE_DAYS = 14;

// Same PIN policy as the owner-managed user creation flow — an invite link
// must not become a way to create an account with PIN "1".
const pinProblem = (pin) => {
  const s = String(pin ?? "");
  if (!/^\d{4,8}$/.test(s)) return "PIN must be 4 to 8 digits.";
  if (/^(\d)\1+$/.test(s)) return "PIN cannot be all the same digit.";
  if (["1234", "0123", "0000", "1111", "12345678", "87654321"].includes(s)) {
    return "That PIN is too easy to guess. Please choose another.";
  }
  return null;
};

// Public endpoint, so throttle invite guessing and account-creation spam.
const joinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

// Shared join handler — the app exposes this at /api/team/join (public, no auth)
async function handleJoin(req, res) {
  try {
    const { invite, name, pinCode } = req.body;
    if (!invite || !name || !pinCode) {
      return res.status(400).json({ error: "invite, name and pinCode required" });
    }
    const problem = pinProblem(pinCode);
    if (problem) return res.status(400).json({ error: problem });
    const cleanName = cleanString(name, 80);
    if (!cleanName) return res.status(400).json({ error: "name required" });
    if (String(invite).length > 128) {
      return res.status(400).json({ error: "Invite code is not valid." });
    }
    const inv = await prisma.facilityInvite.findUnique({
      where: { token: invite },
      include: { facility: true },
    });
    if (!inv) return res.status(404).json({ error: "Invite not found or already used" });
    if (inv.expiresAt < new Date()) {
      return res.status(410).json({ error: "Invite has expired. Ask the owner to generate a new one." });
    }
    if (inv.usesLeft <= 0) {
      return res.status(410).json({ error: "Invite already used. Ask the owner for a fresh link." });
    }

    // Enforce tier seat limit
    const [facility, activeCount] = await Promise.all([
      prisma.facility.findUnique({ where: { id: inv.facilityId }, include: { users: true } }),
      prisma.user.count({ where: { facilityId: inv.facilityId, active: true } }),
    ]);
    const { getEffectiveTier } = await import("../plans.js");
    const tier = getEffectiveTier(facility);
    if (activeCount >= tier.maxUsers) {
      return res.status(403).json({
        error: `This pharmacy has reached its ${tier.label} plan limit (${tier.maxUsers} users). The owner needs to upgrade to add more staff.`,
      });
    }

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          facilityId: inv.facilityId,
          name: cleanName,
          role: inv.role,
          pinCode: bcrypt.hashSync(String(pinCode), 10),
        },
      });
      // Atomic single-use redemption: only decrement when stock remains, so two
      // simultaneous requests cannot both consume the last use of an invite.
      const consumed = await tx.facilityInvite.updateMany({
        where: { id: inv.id, usesLeft: { gt: 0 } },
        data: { usesLeft: { decrement: 1 } },
      });
      if (consumed.count === 0) {
        throw new Error("INVITE_ALREADY_USED");
      }
      return created;
    });

    res.status(201).json({
      ok: true,
      user: { id: user.id, name: user.name, role: user.role },
      facility: {
        id: inv.facilityId,
        name: inv.facility.name,
        brandName: inv.facility.brandName || inv.facility.name,
      },
    });
  } catch (err) {
    if (String(err?.message || "") === "INVITE_ALREADY_USED") {
      return res.status(410).json({ error: "Invite already used. Ask the owner for a fresh link." });
    }
    serverError(res, err);
  }
}

// Owner generates a staff invite link/QR. Using this link joins the staff
// member straight into THIS clinic — they never pick from a list of clinics,
// so they can't land in another pharmacy by mistake.
router.post("/invites", requireAuth, requireRole("OWNER"), async (req, res) => {
  try {
    const { role } = req.body;
    const inviteRole = ["CASHIER", "PHARMACIST"].includes(role) ? role : "CASHIER";
    const token = randomToken();
    const invite = await prisma.facilityInvite.create({
      data: {
        facilityId: req.user.facilityId,
        token,
        role: inviteRole,
        createdBy: req.user.sub,
        usesLeft: 1,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    res.status(201).json({
      id: invite.id,
      token,
      role: invite.role,
      expiresAt: invite.expiresAt,
      link: `/join?invite=${token}`,
    });
  } catch (err) {
    serverError(res, err);
  }
});

// List active invites for the owner
router.get("/invites", requireAuth, requireRole("OWNER"), async (req, res) => {
  try {
    const invites = await prisma.facilityInvite.findMany({
      where: { facilityId: req.user.facilityId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    res.json(invites);
  } catch (err) {
    serverError(res, err);
  }
});

// Revoke an invite
router.delete("/invites/:id", requireAuth, requireRole("OWNER"), async (req, res) => {
  try {
    const existing = await prisma.facilityInvite.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.facilityId !== req.user.facilityId) {
      return res.status(404).json({ error: "Not found" });
    }
    await prisma.facilityInvite.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err);
  }
});

// Redeem an invite: staff member joins the facility via link/QR.
// Exposed publicly at /api/team/join by the server entrypoint (no auth), so the
// router itself does NOT register /join (it would be behind requireAuth there).
// The exported handler includes the rate limiter so the public mount is throttled.
export const joinHandler = [joinLimiter, handleJoin];
export { router, handleJoin };
export default router;