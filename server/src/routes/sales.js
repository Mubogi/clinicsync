import { Router } from "express";

import { prisma } from "../db.js";

const router = Router();

// FEFO helper: pick the earliest-expiring batch of the given product/unit with stock
async function pickBatch(tx, facilityId, productId, unitType, qty) {
  const batches = await tx.inventory.findMany({
    where: {
      facilityId,
      productId,
      unitType,
      quantity: { gt: 0 },
    },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
  });
  for (const b of batches) {
    if (b.quantity >= qty) return b;
  }
  return null;
}

// Create a sale, decrement inventory (FEFO), track cashier attribution + stock movements
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

      // Honor per-unit catalog pricing: if the POS passed a productId + unitType,
      // use the product's price for that unit (Tablet/Strip of 10/Box) instead of
      // the batch's sellingPrice. Falls back to batch price for older clients.
      let product = null;
      let unitPrice = inv.sellingPrice;
      if (it.productId) {
        product = await tx.product.findUnique({ where: { id: it.productId } });
        if (product) {
          const byUnit = {
            Tablet: product.tabletPrice,
            "Strip of 10": product.stripPrice,
            "Strip of 6": product.stripPrice,
            Box: product.boxPrice,
          }[it.unitType];
          if (byUnit != null && byUnit > 0) unitPrice = byUnit;
        }
      }
      const totalPrice = unitPrice * it.quantity;
      totalAmount += totalPrice;

      // Per-unit cost snapshot, scaled from the batch cost to the actual unit sold.
      // Ratio-based: a tablet costs ~ (tabletPrice/stripPrice) of a strip, a box
      // costs ~ (boxPrice/stripPrice) of a strip.
      let costNow = inv.costPrice || 0;
      if (product) {
        const sp = product.stripPrice || 0;
        const tp = product.tabletPrice || 0;
        const bp = product.boxPrice || 0;
        if (it.unitType === "Tablet" && sp > 0 && tp > 0) {
          costNow = costNow * (tp / sp);
        } else if (it.unitType === "Box" && sp > 0 && bp > 0) {
          costNow = costNow * (bp / sp);
        }
      }

      await tx.inventory.update({
        where: { id: inv.id },
        data: { quantity: { decrement: it.quantity }, syncStatus: false },
      });

      await tx.stockMovement.create({
        data: {
          facilityId: req.user.facilityId,
          inventoryId: inv.id,
          delta: -it.quantity,
          reason: "SALE",
          userId: req.user.sub || null,
        },
      });

      saleItems.push({
        inventoryId: inv.id,
        productId: inv.productId || undefined,
        drugName: inv.drugName,
        unitType: it.unitType || inv.unitType,
        quantity: it.quantity,
        unitPrice,
        totalPrice,
        costPrice: costNow,
      });
    }

    const cash = Number(cashPaid || 0);
    const momo = Number(momoPaid || 0);

    const sale = await tx.sale.create({
      data: {
        facilityId: req.user.facilityId,
        userId: req.user.sub || null,
        cashierName: req.user.name || null,
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