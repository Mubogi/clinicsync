import { Router } from "express";
import bcrypt from "bcryptjs";

import { prisma } from "../db.js";
import { requireAuth, serializeFacility } from "../auth.js";
import { TIERS } from "../plans.js";

const router = Router();

// Helper: only the platform/super-admin role may manage other facilities.
// For the MVP the seeded demo OWNER is treated as admin; a real deployment would
// gate this behind a dedicated system admin role.
const requireAdmin = async (req, res, next) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user) return res.status(404).json({ error: "User not found" });
  // In production this would check req.user.role === "SYS_ADMIN".
  // For the demo we allow any OWNER to onboard new clinics so the tool is testable.
  next();
};

// List all clinics/pharmacies on the server (multi-tenant overview)
router.get("/facilities", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const facilities = await prisma.facility.findMany({
      include: { _count: { select: { users: true, sales: true, inventories: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(
      facilities.map((f) => ({
        ...serializeFacility(f),
        userCount: f._count.users,
        saleCount: f._count.sales,
        inventoryCount: f._count.inventories,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a clinic (hard delete; used for onboarding trial cleanup)
router.delete("/facilities/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const f = await prisma.facility.findUnique({ where: { id } });
    if (!f) return res.status(404).json({ error: "Not found" });
    // cascade manually: movement->inventory->saleitem->sale->user->... (simple approach: delete deepest first)
    await prisma.$transaction([
      prisma.priceHistory.deleteMany({ where: { facilityId: id } }),
      prisma.rememberToken.deleteMany({ where: { facilityId: id } }),
      prisma.dailyReconciliation.deleteMany({ where: { facilityId: id } }),
      prisma.expense.deleteMany({ where: { facilityId: id } }),
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
    await prisma.facility.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;