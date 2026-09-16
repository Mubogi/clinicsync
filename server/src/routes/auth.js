import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";

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
import { serverError, cleanString } from "../http.js";

const router = Router();

// A 4-digit PIN space is small, so throttle online guessing per IP and per
// account. Limits are generous enough for a shared shop device with typos.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait 15 minutes and try again." },
});

const pinChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait and try again." },
});

// Login by facility name + PIN (optionally remember-me for persistent login)
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { facilityName, pinCode, remember } = req.body;
    if (!facilityName || !pinCode) {
      return res.status(400).json({ error: "Facility name and PIN required" });
    }
    if (String(pinCode).length > 64 || String(facilityName).length > 200) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const facility = await prisma.facility.findFirst({
      where: { name: facilityName },
      include: { users: true },
    });

    // Same message and shape whether the facility or the PIN was wrong, so the
    // endpoint cannot be used to enumerate which clinics exist.
    const invalid = () => res.status(401).json({ error: "Invalid facility name or PIN" });
    if (!facility) return invalid();

    const user = facility.users.find(
      (u) => u.active && bcrypt.compareSync(String(pinCode), u.pinCode)
    );
    if (!user) return invalid();

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
    res.status(500).json({ error: "Login failed" });
  }
});

// Remember-me auto-login: exchange a persistent token for a session
router.post("/remember", loginLimiter, async (req, res) => {
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
    res.status(500).json({ error: "Could not restore session" });
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
    serverError(res, err);
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
    serverError(res, err);
  }
});

// PIN rules: digits only, 4–8 long. Enforced on every write path so a weak
// PIN can never be created through any endpoint.
function pinProblem(pin) {
  const s = String(pin ?? "");
  if (!/^\d{4,8}$/.test(s)) return "PIN must be 4 to 8 digits.";
  if (/^(\d)\1+$/.test(s)) return "PIN cannot be all the same digit.";
  if (["1234", "0123", "0000", "1111", "12345678", "87654321"].includes(s)) {
    return "That PIN is too easy to guess. Please choose another.";
  }
  return null;
}

// Change PIN
router.post("/change-pin", requireAuth, pinChangeLimiter, async (req, res) => {
  try {
    const { oldPin, newPin } = req.body;
    if (!oldPin || !newPin) {
      return res.status(400).json({ error: "oldPin and newPin required" });
    }
    const problem = pinProblem(newPin);
    if (problem) return res.status(400).json({ error: problem });
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!bcrypt.compareSync(String(oldPin), user.pinCode)) {
      return res.status(401).json({ error: "Old PIN is incorrect" });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { pinCode: bcrypt.hashSync(String(newPin), 10) },
    });
    // A changed PIN invalidates existing persistent logins, so an old device
    // cannot keep using the account after the owner rotates the PIN.
    await revokeAllRememberTokens(user.id);
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err);
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
    serverError(res, err);
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
    serverError(res, err);
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
    const problem = pinProblem(pinCode);
    if (problem) return res.status(400).json({ error: problem });
    const cleanName = cleanString(name, 80);
    if (!cleanName) return res.status(400).json({ error: "name required" });
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
        name: cleanName,
        role,
        pinCode: bcrypt.hashSync(String(pinCode), 10),
      },
    });
    res.status(201).json({ id: user.id, name: user.name, role: user.role });
  } catch (err) {
    serverError(res, err);
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
    if (name) data.name = cleanString(name, 80) || existing.name;
    if (role && ["OWNER", "PHARMACIST", "CASHIER"].includes(role)) data.role = role;
    if (pinCode) {
      const problem = pinProblem(pinCode);
      if (problem) return res.status(400).json({ error: problem });
      data.pinCode = bcrypt.hashSync(String(pinCode), 10);
    }
    if (typeof active === "boolean") data.active = active;
    const user = await prisma.user.update({ where: { id }, data });
    // Rotating a PIN or disabling the account must kill existing persistent
    // logins, otherwise the old device keeps working for up to 30 days.
    if (data.pinCode || data.active === false) {
      await revokeAllRememberTokens(id);
    }
    res.json({ id: user.id, name: user.name, role: user.role, active: user.active });
  } catch (err) {
    serverError(res, err);
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
    serverError(res, err);
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
    serverError(res, err);
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
    serverError(res, err);
  }
});

// Public subscription plan catalogue (for the owner to pick a tier)
router.get("/plans", (_req, res) => {
  res.json({ plans: TIERS });
});

// ----------  FIRST-TIME SETUP  ----------
// Set clinic details + onboard while staff can select from the Uganda drug
// library. Marks the facility onboarded=true so the login flow stops showing
// the setup wizard. Owner-only.
router.post("/facility/setup", requireAuth, requireRole("OWNER"), async (req, res) => {
  try {
    const {
      brandName,
      tagline,
      logoEmoji,
      address,
      phone,
      subscriptionTier,
      // selected medicines [{ name, genericName, unitType, quantity, costPrice, sellingPrice, expiryDate ? }]
      initialStock = [],
      skipStock,
    } = req.body;

    if (!Array.isArray(initialStock)) {
      return res.status(400).json({ error: "initialStock must be a list of medicines." });
    }
    if (initialStock.length > 500) {
      return res.status(400).json({ error: "Please select at most 500 medicines during setup." });
    }

    const facility = await prisma.facility.update({
      where: { id: req.user.facilityId },
      data: {
        brandName: cleanString(brandName, 120) ?? undefined,
        tagline: cleanString(tagline, 160) ?? undefined,
        logoEmoji: cleanString(logoEmoji, 8) ?? undefined,
        address: cleanString(address, 240) ?? undefined,
        phone: cleanString(phone, 40) ?? undefined,
        subscriptionTier: subscriptionTier && TIERS[subscriptionTier] ? subscriptionTier : undefined,
        onboarded: true,
      },
    });

    // Only create products+inventory when the owner picked initial stock.
    // If a medicine already exists (by name) we just restock it instead of
    // duplicating — reducing redundancy like they asked.
    let created = 0;
    let restocked = 0;
    if (!skipStock && Array.isArray(initialStock) && initialStock.length > 0) {
      for (const m of initialStock) {
        const existing = await prisma.product.findFirst({
          where: { facilityId: req.user.facilityId, name: m.name },
        });
        if (!existing) {
          // if library entry has pack info, use it
          const prod = await prisma.product.create({
            data: {
              facilityId: req.user.facilityId,
              name: m.name,
              genericName: m.genericName || null,
              tabletPrice: m.tabletPrice != null ? Number(m.tabletPrice) : null,
              stripPrice: m.stripPrice != null ? Number(m.stripPrice) : null,
              boxPrice: m.boxPrice != null ? Number(m.boxPrice) : null,
              costPrice: Number(m.costPrice || 0),
              stripsPerBox: m.stripsPerBox ? Number(m.stripsPerBox) : null,
              tabletsPerStrip: m.tabletsPerStrip ? Number(m.tabletsPerStrip) : null,
            },
          });
          await prisma.inventory.create({
            data: {
              facilityId: req.user.facilityId,
              productId: prod.id,
              drugName: m.name,
              unitType: m.unitType || "Strip of 10",
              quantity: Number(m.quantity) || 0,
              costPrice: Number(m.costPrice || 0),
              sellingPrice: Number(m.sellingPrice || m.costPrice || 0),
              expiryDate: m.expiryDate ? new Date(m.expiryDate) : null,
              reorderLevel: Number(m.reorderLevel || 10),
            },
          });
          created++;
        } else {
          // restock the existing product's default batch (increase quantity)
          const inv = await prisma.inventory.findFirst({
            where: { facilityId: req.user.facilityId, productId: existing.id },
          });
          if (inv) {
            await prisma.inventory.update({
              where: { id: inv.id },
              data: {
                quantity: { increment: Number(m.quantity) || 0 },
                costPrice: m.costPrice != null ? Number(m.costPrice) : inv.costPrice,
              },
            });
            restocked++;
          } else {
            await prisma.inventory.create({
              data: {
                facilityId: req.user.facilityId,
                productId: existing.id,
                drugName: m.name,
                unitType: m.unitType || "Strip of 10",
                quantity: Number(m.quantity) || 0,
                costPrice: Number(m.costPrice || 0),
                sellingPrice: Number(m.sellingPrice || m.costPrice || 0),
                expiryDate: m.expiryDate ? new Date(m.expiryDate) : null,
                reorderLevel: Number(m.reorderLevel || 10),
              },
            });
            created++;
          }
        }
      }
    }

    res.json({
      facility: serializeFacility(facility),
      stockAdded: created,
      stockRestocked: restocked,
      onboarded: true,
    });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;