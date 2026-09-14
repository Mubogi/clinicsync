import { Router } from "express";
import bcrypt from "bcryptjs";

import { prisma } from "../db.js";
import { signToken, requireAuth, requireRole } from "../auth.js";

const router = Router();

// Login by facility name + PIN
router.post("/login", async (req, res) => {
  try {
    const { facilityName, pinCode } = req.body;
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

    const user = facility.users.find((u) => bcrypt.compareSync(String(pinCode), u.pinCode));
    if (!user) {
      return res.status(401).json({ error: "Invalid PIN" });
    }

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, name: user.name, role: user.role, facilityId: user.facilityId },
      facility: { id: facility.id, name: facility.name, subscriptionTier: facility.subscriptionTier },
    });
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
      facility: { id: user.facility.id, name: user.facility.name, subscriptionTier: user.facility.subscriptionTier },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List users in facility
router.get("/users", requireAuth, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { facilityId: req.user.facilityId },
      select: { id: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Owner creates a user
router.post("/users", requireAuth, requireRole("OWNER"), async (req, res) => {
  try {
    const { name, role, pinCode } = req.body;
    if (!name || !role || !pinCode) {
      return res.status(400).json({ error: "name, role and pinCode required" });
    }
    if (!["OWNER", "PHARMACIST", "CASHIER"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
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
    res.json({ subscriptionTier: facility.subscriptionTier });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;