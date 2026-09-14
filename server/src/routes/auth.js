import { Router } from "express";
import bcrypt from "bcryptjs";

import { prisma } from "../db.js";
import {
  signToken,
  requireAuth,
  requireRole,
  createRememberToken,
  consumeRememberToken,
  revokeAllRememberTokens,
  serializeFacility,
} from "../auth.js";
import { TIERS, getTier } from "../plans.js";

const router = Router();

// Login by facility name + PIN (optionally remember-me for persistent login)
router.post("/login", async (req, res) => {
  try {
    const { facilityName, pinCode, remember } = req.body;
    if (!facilityName || !pinCode) {
      return res.status(400).json({ error: "Facility name and PIN required" });
    }

    const facility = await prisma.facility.findFirst({
      where: { name: facilityName },
      include: { users: true },
    });

    if (!facility) {
      return res.status(401).json({ error: "Facility not found" });
    }

    const user = facility.users.find(
      (u) => u.active && bcrypt.compareSync(String(pinCode), u.pinCode)
    );
    if (!user) {
      return res.status(401).json({ error: "Invalid PIN or user deactivated" });
    }

    const token = signToken(user);
    let rememberToken = null;
    if (remember) {
      rememberToken = await createRememberToken(user, facility.id);
    }
    res.json({
      token,
      rememberToken,
      user: { id: user.id, name: user.name, role: user.role, facilityId: user.facilityId },
      facility: serializeFacility(facility),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remember-me auto-login: exchange a persistent token for a session
router.post("/remember", async (req, res) => {
  try {
    const { rememberToken } = req.body;
    const result = await consumeRememberToken(rememberToken);
    if (!result) return res.status(401).json({ error: "Remember-me token invalid or expired" });
    const { user, facility } = result;
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, name: user.name, role: user.role, facilityId: user.facilityId },
      facility: serializeFacility(facility),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Logout: revoke remember-me if requested
router.post("/logout", requireAuth, async (req, res) => {
  try {
    if (req.body?.revokeRemember) {
      await revokeAllRememberTokens(req.user.sub);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public list of facility names for the login picker (many clinics on one server)
router.get("/facilities", async (_req, res) => {
  try {
    const facilities = await prisma.facility.findMany({
      select: { id: true, name: true, brandName: true, subscriptionTier: true, slug: true },
      orderBy: { name: "asc" },
    });
    res.json(facilities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change PIN
router.post("/change-pin", requireAuth, async (req, res) => {
  try {
    const { oldPin, newPin } = req.body;
    if (!oldPin || !newPin || String(newPin).length < 4) {
      return res.status(400).json({ error: "oldPin and newPin (>=4 digits) required" });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!bcrypt.compareSync(String(oldPin), user.pinCode)) {
      return res.status(401).json({ error: "Old PIN is incorrect" });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { pinCode: bcrypt.hashSync(String(newPin), 10) },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Me
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      include: { facility: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({
      user: { id: user.id, name: user.name, role: user.role, facilityId: user.facilityId },
      facility: serializeFacility(user.facility),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List users in facility (with tier info for slots)
router.get("/users", requireAuth, async (req, res) => {
  try {
    const [users, facility] = await Promise.all([
      prisma.user.findMany({
        where: { facilityId: req.user.facilityId },
        select: { id: true, name: true, role: true, active: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.facility.findUnique({ where: { id: req.user.facilityId } }),
    ]);
    const tier = getTier(facility?.subscriptionTier);
    res.json({
      users,
      plan: {
        tier: facility?.subscriptionTier,
        maxUsers: tier?.maxUsers,
        used: users.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Owner creates a user, enforcing the tier's seat limit
router.post("/users", requireAuth, requireRole("OWNER"), async (req, res) => {
  try {
    const { name, role, pinCode } = req.body;
    if (!name || !role || !pinCode) {
      return res.status(400).json({ error: "name, role and pinCode required" });
    }
    if (!["OWNER", "PHARMACIST", "CASHIER"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    const facility = await prisma.facility.findUnique({
      where: { id: req.user.facilityId },
      include: { users: true },
    });
    const tier = getTier(facility?.subscriptionTier);
    const activeCount = facility.users.filter((u) => u.active).length;
    if (activeCount >= tier.maxUsers) {
      return res.status(403).json({
        error: `Your ${tier.label} plan allows a maximum of ${tier.maxUsers} user(s). Upgrade to add more cashiers/pharmacists.`,
      });
    }
    const user = await prisma.user.create({
      data: {
        facilityId: req.user.facilityId,
        name,
        role,
        pinCode: bcrypt.hashSync(String(pinCode), 10),
      },
    });
    res.status(201).json({ id: user.id, name: user.name, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Owner edits a user (name/role, reset PIN) — also re-enable a removed user
router.patch("/users/:id", requireAuth, requireRole("OWNER"), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing || existing.facilityId !== req.user.facilityId) {
      return res.status(404).json({ error: "Not found" });
    }
    const { name, role, pinCode, active } = req.body;
    const data = {};
    if (name) data.name = name;
    if (role && ["OWNER", "PHARMACIST", "CASHIER"].includes(role)) data.role = role;
    if (pinCode) data.pinCode = bcrypt.hashSync(String(pinCode), 10);
    if (typeof active === "boolean") data.active = active;
    const user = await prisma.user.update({ where: { id }, data });
    res.json({ id: user.id, name: user.name, role: user.role, active: user.active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Owner "removes" a user (soft-delete: deactivates + revokes their sessions)
// Cashier sales history is preserved via cashierName snapshot.
router.delete("/users/:id", requireAuth, requireRole("OWNER"), async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user.sub) {
      return res.status(400).json({ error: "You cannot remove yourself" });
    }
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing || existing.facilityId !== req.user.facilityId) {
      return res.status(404).json({ error: "Not found" });
    }
    await prisma.$transaction([
      prisma.rememberToken.deleteMany({ where: { userId: id } }),
      prisma.user.update({ where: { id }, data: { active: false } }),
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Owner updates the facility branding (shown across the whole system)
router.patch("/facility/branding", requireAuth, requireRole("OWNER"), async (req, res) => {
  try {
    const { brandName, tagline, logoEmoji, address, phone } = req.body;
    const facility = await prisma.facility.update({
      where: { id: req.user.facilityId },
      data: {
        brandName: brandName ?? undefined,
        tagline: tagline ?? undefined,
        logoEmoji: logoEmoji ?? undefined,
        address: address ?? undefined,
        phone: phone ?? undefined,
      },
    });
    res.json(serializeFacility(facility));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Owner updates tier
router.patch("/facility/tier", requireAuth, requireRole("OWNER"), async (req, res) => {
  try {
    const { subscriptionTier } = req.body;
    if (!["BASIC", "PREMIUM", "PRO"].includes(subscriptionTier)) {
      return res.status(400).json({ error: "Invalid tier" });
    }
    const facility = await prisma.facility.update({
      where: { id: req.user.facilityId },
      data: { subscriptionTier },
    });
    res.json(serializeFacility(facility));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public subscription plan catalogue (for the owner to pick a tier)
router.get("/plans", (_req, res) => {
  res.json({ plans: TIERS });
});

export default router;