import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";

const router = Router();

const randomToken = () => crypto.randomBytes(20).toString("hex");
const INVITE_DAYS = 14;

// Shared join handler — the app exposes this at /api/team/join (public, no auth)
async function handleJoin(req, res) {
  try {
    const { invite, name, pinCode } = req.body;
    if (!invite || !name || !pinCode) {
      return res.status(400).json({ error: "invite, name and pinCode required" });
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
    const { getTier } = await import("../plans.js");
    const tier = getTier(facility?.subscriptionTier);
    if (activeCount >= tier.maxUsers) {
      return res.status(403).json({
        error: `This pharmacy has reached its ${tier.label} plan limit (${tier.maxUsers} users). The owner needs to upgrade to add more staff.`,
      });
    }

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          facilityId: inv.facilityId,
          name,
          role: inv.role,
          pinCode: bcrypt.hashSync(String(pinCode), 10),
        },
      });
      if (inv.usesLeft <= 1) {
        await tx.facilityInvite.update({ where: { id: inv.id }, data: { usesLeft: 0 } });
      } else {
        await tx.facilityInvite.update({ where: { id: inv.id }, data: { usesLeft: { decrement: 1 } } });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// Redeem an invite: staff member joins the facility via link/QR.
// Exposed publicly at /api/team/join by the server entrypoint (no auth), so the
// router itself does NOT register /join (it would be behind requireAuth there).
export { router, handleJoin };
export default router;