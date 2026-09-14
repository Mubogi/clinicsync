import { Router } from "express";

import { prisma } from "../db.js";
import { requireRole } from "../auth.js";

const router = Router();

// List inventory for facility, with optional search query
router.get("/", async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim().toLowerCase();
    const items = await prisma.inventory.findMany({
      where: {
        facilityId: req.user.facilityId,
        ...(q
          ? {
              OR: [
                { drugName: { contains: q, mode: "insensitive" } },
                { unitType: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { drugName: "asc" },
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Low-stock alerts (Premium+ feature flag handled client-side)
router.get("/low-stock", async (req, res) => {
  try {
    const items = await prisma.inventory.findMany({
      where: { facilityId: req.user.facilityId },
      orderBy: { quantity: "asc" },
    });
    const low = items.filter((i) => i.quantity <= i.reorderLevel);
    res.json(low);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create inventory item
router.post("/", requireRole("OWNER", "PHARMACIST"), async (req, res) => {
  try {
    const { drugName, unitType, quantity, costPrice, sellingPrice, expiryDate, reorderLevel } = req.body;
    if (!drugName || !unitType || quantity == null || sellingPrice == null) {
      return res.status(400).json({ error: "drugName, unitType, quantity, sellingPrice required" });
    }
    const item = await prisma.inventory.create({
      data: {
        facilityId: req.user.facilityId,
        drugName,
        unitType,
        quantity: Number(quantity),
        costPrice: Number(costPrice || 0),
        sellingPrice: Number(sellingPrice),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        reorderLevel: Number(reorderLevel || 10),
      },
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update inventory item
router.patch("/:id", requireRole("OWNER", "PHARMACIST"), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.inventory.findUnique({ where: { id } });
    if (!existing || existing.facilityId !== req.user.facilityId) {
      return res.status(404).json({ error: "Not found" });
    }
    const { drugName, unitType, quantity, costPrice, sellingPrice, expiryDate, reorderLevel } = req.body;
    const item = await prisma.inventory.update({
      where: { id },
      data: {
        drugName: drugName ?? existing.drugName,
        unitType: unitType ?? existing.unitType,
        quantity: quantity != null ? Number(quantity) : existing.quantity,
        costPrice: costPrice != null ? Number(costPrice) : existing.costPrice,
        sellingPrice: sellingPrice != null ? Number(sellingPrice) : existing.sellingPrice,
        expiryDate: expiryDate !== undefined ? (expiryDate ? new Date(expiryDate) : null) : existing.expiryDate,
        reorderLevel: reorderLevel != null ? Number(reorderLevel) : existing.reorderLevel,
      },
    });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Adjust stock (restock or decrement)
router.post("/:id/adjust", requireRole("OWNER", "PHARMACIST"), async (req, res) => {
  try {
    const { id } = req.params;
    const { delta, note, costPrice } = req.body;
    const existing = await prisma.inventory.findUnique({ where: { id } });
    if (!existing || existing.facilityId !== req.user.facilityId) {
      return res.status(404).json({ error: "Not found" });
    }
    const amount = Number(delta || 0);
    const item = await prisma.inventory.update({
      where: { id },
      data: {
        quantity: Math.max(0, existing.quantity + amount),
        costPrice: costPrice != null ? Number(costPrice) : existing.costPrice,
      },
    });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete inventory item
router.delete("/:id", requireRole("OWNER"), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.inventory.findUnique({ where: { id } });
    if (!existing || existing.facilityId !== req.user.facilityId) {
      return res.status(404).json({ error: "Not found" });
    }
    await prisma.inventory.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;