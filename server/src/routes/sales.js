import { Router } from "express";

import { prisma } from "../db.js";

const router = Router();

// Create a sale, decrement inventory, generate receipt number
router.post("/", async (req, res) => {
  const { items, cashPaid, momoPaid, paymentMethod, momoNetwork } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "At least one sale item required" });
  }

  // Validate items
  for (const it of items) {
    if (!it.inventoryId || !it.quantity || it.quantity <= 0) {
      return res.status(400).json({ error: "Each item needs inventoryId and positive quantity" });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // Determine next receipt number for this facility
    const lastSale = await tx.sale.findFirst({
      where: { facilityId: req.user.facilityId },
      orderBy: { receiptNumber: "desc" },
    });
    const receiptNumber = (lastSale?.receiptNumber || 0) + 1;

    const saleItems = [];
    let totalAmount = 0;

    for (const it of items) {
      const inv = await tx.inventory.findUnique({ where: { id: it.inventoryId } });
      if (!inv || inv.facilityId !== req.user.facilityId) {
        throw new Error(`Inventory item not found: ${it.inventoryId}`);
      }
      if (inv.quantity < it.quantity) {
        throw new Error(`Insufficient stock for ${inv.drugName} (have ${inv.quantity})`);
      }
      const unitPrice = inv.sellingPrice;
      const totalPrice = unitPrice * it.quantity;
      totalAmount += totalPrice;

      await tx.inventory.update({
        where: { id: inv.id },
        data: { quantity: { decrement: it.quantity }, syncStatus: false },
      });

      saleItems.push({
        drugName: inv.drugName,
        quantity: it.quantity,
        unitPrice,
        totalPrice,
      });
    }

    const cash = Number(cashPaid || 0);
    const momo = Number(momoPaid || 0);

    const sale = await tx.sale.create({
      data: {
        facilityId: req.user.facilityId,
        receiptNumber,
        totalAmount,
        cashPaid: cash,
        momoPaid: momo,
        paymentMethod: paymentMethod || "CASH",
        momoNetwork: momoNetwork || null,
        items: { create: saleItems },
      },
      include: { items: true },
    });

    return sale;
  });

  res.status(201).json(result);
});

// List sales (optional date range), paginated
router.get("/", async (req, res) => {
  try {
    const from = req.query.from;
    const to = req.query.to;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const where = { facilityId: req.user.facilityId };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    const sales = await prisma.sale.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    res.json(sales);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a single sale by receipt number
router.get("/receipt/:receiptNumber", async (req, res) => {
  try {
    const sale = await prisma.sale.findFirst({
      where: { facilityId: req.user.facilityId, receiptNumber: Number(req.params.receiptNumber) },
      include: { items: true, facility: true },
    });
    if (!sale) return res.status(404).json({ error: "Receipt not found" });
    res.json(sale);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;