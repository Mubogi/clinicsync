import { Router } from "express";

import { prisma } from "../db.js";
import { serverError, toPositiveInt } from "../http.js";

const router = Router();

// How many tablets one of `unitType` contains. Expressing every unit in tablets
// lets a sale in one unit be satisfied from a batch stocked in another (sell a
// tablet from a box, a strip from a box, and so on). Returns 0 for units that
// have no defined relationship (Bottle, Sachet, unknown), which the caller
// treats as "only sellable as itself".
function tabletsPerUnit(unitType, product) {
  const t = String(unitType || "").toLowerCase();
  if (t.startsWith("tablet")) return 1;
  if (t.startsWith("strip")) {
    // "Strip of 10" / "Strip of 6" carry their own size; fall back to the pack.
    const n = parseInt(t.replace(/[^0-9]/g, ""), 10);
    if (Number.isInteger(n) && n > 0) return n;
    return product?.tabletsPerStrip || 0;
  }
  if (t.startsWith("box")) {
    const spb = product?.stripsPerBox || 0;
    const tps = product?.tabletsPerStrip || 0;
    return spb > 0 && tps > 0 ? spb * tps : 0;
  }
  return 0;
}

// Sell `qty` of `sellUnit` out of `inv`, opening larger units when the sale
// does not divide evenly. A shop that stocks boxes but sells strips has stock
// of 5 boxes and wants to sell 2 strips: one box is opened, 2 strips go to the
// customer and the remaining 8 stay as stock. Keeping every stored quantity a
// whole number avoids fractional inventory, which would make counts and audits
// meaningless.
async function takeFromStock(tx, { facilityId, inv, product, sellUnit, qty, userId }) {
  const sellPer = tabletsPerUnit(sellUnit, product);
  const invPer = tabletsPerUnit(inv.unitType, product);
  const simple = async (batchId, amount, batchUnit) => {
    await tx.inventory.update({
      where: { id: batchId },
      data: { quantity: { decrement: amount }, syncStatus: false },
    });
    await tx.stockMovement.create({
      data: { facilityId, inventoryId: batchId, delta: -amount, reason: "SALE", userId },
    });
    return { batchId, unitType: batchUnit };
  };

  // Same unit, or no defined relationship between them: decrement as-is.
  if (String(sellUnit) === String(inv.unitType) || sellPer <= 0 || invPer <= 0) {
    if (inv.quantity < qty) {
      throw new Error(`Insufficient stock for ${inv.drugName} (have ${inv.quantity})`);
    }
    return simple(inv.id, qty, inv.unitType);
  }

  // Exact conversion is possible without opening anything.
  const needed = (sellPer * qty) / invPer;
  if (Number.isInteger(needed)) {
    if (inv.quantity < needed) {
      throw new Error(
        `Insufficient stock for ${inv.drugName}: need ${needed} ${inv.unitType} for ${qty} ${sellUnit} (have ${inv.quantity})`
      );
    }
    return simple(inv.id, needed, inv.unitType);
  }

  // Converting down to a larger unit (e.g. buying boxes out of strips) cannot
  // be done by opening packs, so only an exact match is allowed.
  if (invPer <= sellPer) {
    throw new Error(
      `Cannot sell ${qty} × ${sellUnit} from stock kept in ${inv.unitType} (not a whole number of units)`
    );
  }
  if (invPer % sellPer !== 0) {
    throw new Error(`Cannot split ${inv.unitType} into ${sellUnit} — check the pack size`);
  }

  const perBatchUnit = invPer / sellPer;
  const unitsToOpen = Math.ceil(qty / perBatchUnit);
  if (inv.quantity < unitsToOpen) {
    throw new Error(
      `Insufficient stock for ${inv.drugName}: opening 1 ${inv.unitType} gives ${perBatchUnit} ${sellUnit}, ` +
        `so ${qty} ${sellUnit} needs ${unitsToOpen} ${inv.unitType} (have ${inv.quantity})`
    );
  }

  await tx.inventory.update({
    where: { id: inv.id },
    data: { quantity: { decrement: unitsToOpen }, syncStatus: false },
  });
  await tx.stockMovement.create({
    data: { facilityId, inventoryId: inv.id, delta: -unitsToOpen, reason: "SPLIT", userId },
  });

  const produced = unitsToOpen * perBatchUnit;
  const leftover = produced - qty;
  // Cost per smaller unit is derived from the pack, so margin stays correct.
  const unitCost = (inv.costPrice || 0) / perBatchUnit;
  // Price the opened stock at the catalog price for its unit when one exists,
  // otherwise inherit the batch price it came from.
  const openedPrice =
    {
      Tablet: product?.tabletPrice,
      "Strip of 10": product?.stripPrice,
      "Strip of 6": product?.stripPrice,
      Box: product?.boxPrice,
    }[sellUnit] ?? inv.sellingPrice;

  // The pack was exactly consumed by this sale: nothing is left to keep, so the
  // decrement already made on the source batch is the whole story.
  if (leftover === 0) {
    return { batchId: inv.id, unitType: sellUnit };
  }

  // Reuse an existing batch of the target unit with the same expiry, so
  // repeated singles sales do not litter the inventory with tiny batches.
  const existing = await tx.inventory.findFirst({
    where: {
      facilityId,
      productId: inv.productId,
      unitType: sellUnit,
      expiryDate: inv.expiryDate,
    },
  });

  let targetId;
  if (existing) {
    targetId = existing.id;
    await tx.inventory.update({
      where: { id: targetId },
      data: { quantity: { increment: produced }, syncStatus: false },
    });
  } else {
    const created = await tx.inventory.create({
      data: {
        facilityId,
        productId: inv.productId,
        drugName: inv.drugName,
        unitType: sellUnit,
        quantity: produced,
        costPrice: unitCost,
        sellingPrice: openedPrice,
        expiryDate: inv.expiryDate,
        supplier: inv.supplier,
        batch: inv.batch,
        reorderLevel: inv.reorderLevel,
      },
    });
    targetId = created.id;
  }

  // Credit the whole opened pack, then let the normal sale decrement take the
  // sold units back out — this keeps the movement trail auditable.
  await tx.stockMovement.create({
    data: { facilityId, inventoryId: targetId, delta: produced, reason: "SPLIT", userId },
  });
  return simple(targetId, qty, sellUnit);
}

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
  if (items.length > 200) {
    return res.status(400).json({ error: "Too many items in one sale." });
  }
  if (paymentMethod && !["CASH", "MOMO", "MIXED"].includes(paymentMethod)) {
    return res.status(400).json({ error: "Invalid payment method." });
  }
  if (momoNetwork && !["MTN", "AIRTEL"].includes(momoNetwork)) {
    return res.status(400).json({ error: "Invalid mobile-money network." });
  }

  // Validate items
  for (const it of items) {
    if (!it.inventoryId || toPositiveInt(it.quantity) == null) {
      return res.status(400).json({ error: "Each item needs inventoryId and a positive whole quantity" });
    }
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
    // Serialize receipts for this facility. Postgres advisory locks are keyed on
    // a 64-bit int, so we hash the facilityId into one. Without this, two
    // concurrent sales read the same "last receipt" and both write N+1.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${req.user.facilityId}))`;

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

      // Honor per-unit catalog pricing: if the POS passed a productId + unitType,
      // use the product's price for that unit (Tablet/Strip of 10/Box) instead of
      // the batch's sellingPrice. Falls back to batch price for older clients.
      let product = null;
      let unitPrice = inv.sellingPrice;
      if (it.productId) {
        // Scoped to this facility: otherwise a foreign productId would leak
        // another clinic's catalogue pricing into this sale.
        product = await tx.product.findFirst({
          where: { id: it.productId, facilityId: req.user.facilityId },
        });
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

      // The POS sends inventoryId (the batch tapped) plus the chosen unit. When
      // those differ the sale is served by converting or opening packs, so the
      // decrement reflects whole units of whatever is actually in stock.
      const taken = await takeFromStock(tx, {
        facilityId: req.user.facilityId,
        inv,
        product,
        sellUnit: it.unitType,
        qty: it.quantity,
        userId: req.user.sub || null,
      });
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

      saleItems.push({
        inventoryId: taken.batchId,
        productId: inv.productId || undefined,
        drugName: inv.drugName,
        unitType: taken.unitType,
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
  } catch (err) {
    // Stock/validation failures raised inside the transaction carry a message we
    // authored, so they are safe to surface to the cashier.
    const msg = String(err?.message || "");
    if (/^(Insufficient stock|Inventory item not found|Cannot sell)/.test(msg)) {
      return res.status(409).json({ error: msg });
    }
    return serverError(res, err);
  }
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
    serverError(res, err);
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
    serverError(res, err);
  }
});

export default router;