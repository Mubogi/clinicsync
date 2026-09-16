import { Router } from "express";

import { prisma } from "../db.js";
import { requireRole } from "../auth.js";
import { serverError, toPositiveInt, toNonNegativeNumber, cleanString } from "../http.js";

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
    serverError(res, err);
  }
});

// Pack-aware low-stock: also computes tablet/strip/box levels from the linked
// product composition (e.g. 2 boxes + 3 strips + 40 tablets).
router.get("/levels", async (req, res) => {
  try {
    const items = await prisma.inventory.findMany({
      where: { facilityId: req.user.facilityId, quantity: { gt: 0 } },
      include: { product: true },
    });
    const result = {};

    for (const i of items) {
      if (!result[i.drugName]) {
        result[i.drugName] = {
          drugName: i.drugName,
          productId: i.productId || null,
          batches: [],
          // aggregate per-unit equivalents
          tablets: 0,
          strips: 0,
          boxes: 0,
          reorderTablets: i.product?.reorderTablets ?? null,
          reorderStrips: i.product?.reorderStrips ?? null,
          reorderBoxes: i.product?.reorderBoxes ?? null,
        };
      }
      const agg = result[i.drugName];
      agg.batches.push({ id: i.id, unitType: i.unitType, quantity: i.quantity, expiryDate: i.expiryDate, sellingPrice: i.sellingPrice });
      const prod = i.product;
      const stripsPerBox = prod?.stripsPerBox || 10;
      const tabletsPerStrip = prod?.tabletsPerStrip || 10;

      if (i.unitType === "Box") {
        agg.boxes += i.quantity;
        agg.strips += i.quantity * stripsPerBox;
        agg.tablets += i.quantity * stripsPerBox * tabletsPerStrip;
      } else if (i.unitType && i.unitType.toLowerCase().startsWith("strip")) {
        agg.strips += i.quantity;
        agg.tablets += i.quantity * tabletsPerStrip;
      } else if (i.unitType === "Tablet") {
        agg.tablets += i.quantity;
      }
      // non-tablet forms (Bottle/Sachet/Tube) counted as "strips" loosely
      if (!["Box", "Tablet"].includes(i.unitType) && !i.unitType?.toLowerCase().startsWith("strip")) {
        agg.strips += i.quantity;
      }
    }

    // low-stock flags against configured reorder levels
    const rows = Object.values(result).map((r) => {
      const tabletLow =
        r.reorderTablets != null ? r.tablets <= r.reorderTablets : null;
      const stripLow = r.reorderStrips != null ? r.strips <= r.reorderStrips : null;
      const boxLow = r.reorderBoxes != null ? r.boxes <= r.reorderBoxes : null;
      return {
        ...r,
        low: tabletLow === true || stripLow === true || boxLow === true,
        tabletLow,
        stripLow,
        boxLow,
      };
    });

    res.json(rows);
  } catch (err) {
    serverError(res, err);
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
    serverError(res, err);
  }
});

// Create inventory item — also (re)links/creates the Product catalog entry so
// pack-based pricing and "buy a box" work from the same drug.
router.post("/", requireRole("OWNER", "PHARMACIST"), async (req, res) => {
  try {
    const {
      drugName,
      packageUnit, // "Box" when creating a drug as box w/ composition
      unitType,
      quantity,
      costPrice,
      sellingPrice,
      expiryDate,
      reorderLevel,
      stripsPerBox,
      tabletsPerStrip,
      tabletPrice,
      stripPrice,
      boxPrice,
    } = req.body;
    if (!drugName || !unitType || quantity == null || sellingPrice == null) {
      return res.status(400).json({ error: "drugName, unitType, quantity, sellingPrice required" });
    }
    // Per-unit catalog prices. `undefined` means "not supplied" and must not
    // wipe an existing value; an empty string or 0 is an explicit clear/set.
    const priceField = (v) => (v === undefined || v === null || v === "" ? undefined : toNonNegativeNumber(v));
    const explicit = {
      tabletPrice: priceField(tabletPrice),
      stripPrice: priceField(stripPrice),
      boxPrice: priceField(boxPrice),
    };
    if (Object.values(explicit).some((v) => v === null)) {
      return res.status(400).json({ error: "Unit prices must be non-negative numbers" });
    }
    const qty = toNonNegativeNumber(quantity);
    const sell = toNonNegativeNumber(sellingPrice);
    const cost = toNonNegativeNumber(costPrice ?? 0);
    if (qty == null || !Number.isInteger(qty) || qty < 0) {
      return res.status(400).json({ error: "quantity must be a whole number >= 0" });
    }
    if (sell == null || cost == null) {
      return res.status(400).json({ error: "sellingPrice and costPrice must be non-negative numbers" });
    }
    const name = cleanString(drugName, 200);
    if (!name) return res.status(400).json({ error: "drugName required" });
    // find-or-create a Product row for this drug name
    const normalizedName = name;
    let product = await prisma.product.findFirst({
      where: { facilityId: req.user.facilityId, name: normalizedName },
    });

    // Which catalog price this batch's own unit corresponds to. A drug priced
    // as a strip should fill stripPrice, and so on — otherwise the POS has no
    // price to offer for that unit.
    const unitKeyForType = (t) => {
      const s = String(t || "").toLowerCase();
      if (s.startsWith("tablet")) return "tabletPrice";
      if (s.startsWith("strip")) return "stripPrice";
      if (s.startsWith("box")) return "boxPrice";
      return null;
    };
    const packUpdate = {
      ...(toPositiveInt(stripsPerBox) ? { stripsPerBox: toPositiveInt(stripsPerBox) } : {}),
      ...(toPositiveInt(tabletsPerStrip) ? { tabletsPerStrip: toPositiveInt(tabletsPerStrip) } : {}),
    };

    if (!product) {
      // Seed the catalog from the batch just added, unless the caller was
      // explicit. This is what makes a strip-only entry sellable as a strip.
      const seed = { tabletPrice: null, stripPrice: null, boxPrice: null };
      const k = unitKeyForType(unitType);
      if (k) seed[k] = sell;
      product = await prisma.product.create({
        data: {
          facilityId: req.user.facilityId,
          name: normalizedName,
          genericName: null,
          tabletPrice: explicit.tabletPrice ?? seed.tabletPrice,
          stripPrice: explicit.stripPrice ?? seed.stripPrice,
          boxPrice: explicit.boxPrice ?? seed.boxPrice,
          costPrice: cost,
          stripsPerBox: toPositiveInt(stripsPerBox),
          tabletsPerStrip: toPositiveInt(tabletsPerStrip),
        },
      });
    } else {
      // Merge: explicit values win, otherwise fill a still-empty unit from this
      // batch, and never clobber a price the shop already set.
      const data = { ...packUpdate };
      for (const key of ["tabletPrice", "stripPrice", "boxPrice"]) {
        if (explicit[key] !== undefined) data[key] = explicit[key];
        else if (product[key] == null && unitKeyForType(unitType) === key) data[key] = sell;
      }
      product = await prisma.product.update({ where: { id: product.id }, data });
    }

    const item = await prisma.inventory.create({
      data: {
        facilityId: req.user.facilityId,
        productId: product.id,
        drugName: name,
        unitType,
        quantity: qty,
        costPrice: cost,
        sellingPrice: sell,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        reorderLevel: toPositiveInt(reorderLevel) ?? 10,
      },
    });
    await prisma.stockMovement.create({
      data: {
        facilityId: req.user.facilityId,
        inventoryId: item.id,
        delta: qty,
        reason: "INITIAL",
        userId: req.user.sub || null,
      },
    });
    res.status(201).json(item);
  } catch (err) {
    serverError(res, err);
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
    const {
      drugName,
      unitType,
      quantity,
      costPrice,
      sellingPrice,
      expiryDate,
      reorderLevel,
      stripsPerBox,
      tabletsPerStrip,
      tabletPrice,
      stripPrice,
      boxPrice,
    } = req.body;
    if (quantity != null && (!Number.isInteger(Number(quantity)) || Number(quantity) < 0)) {
      return res.status(400).json({ error: "quantity must be a whole number >= 0" });
    }
    if ((costPrice != null && toNonNegativeNumber(costPrice) == null) ||
        (sellingPrice != null && toNonNegativeNumber(sellingPrice) == null)) {
      return res.status(400).json({ error: "costPrice and sellingPrice must be non-negative numbers" });
    }
    if (reorderLevel != null && toNonNegativeNumber(reorderLevel) == null) {
      return res.status(400).json({ error: "reorderLevel must be a non-negative number" });
    }

    // Per-unit prices live on the linked Product, which is what the POS sells
    // from. Editing them here keeps "what I set in Inventory" and "what the
    // cashier can sell" in agreement.
    const priceField = (v) => (v === undefined || v === null || v === "" ? undefined : toNonNegativeNumber(v));
    const explicit = {
      tabletPrice: priceField(tabletPrice),
      stripPrice: priceField(stripPrice),
      boxPrice: priceField(boxPrice),
    };
    if (Object.values(explicit).some((v) => v === null)) {
      return res.status(400).json({ error: "Unit prices must be non-negative numbers" });
    }
    const nextSpb = stripsPerBox !== undefined ? toPositiveInt(stripsPerBox) : undefined;
    const nextTps = tabletsPerStrip !== undefined ? toPositiveInt(tabletsPerStrip) : undefined;
    if (stripsPerBox !== undefined && stripsPerBox !== "" && nextSpb == null) {
      return res.status(400).json({ error: "stripsPerBox must be a positive whole number" });
    }
    if (tabletsPerStrip !== undefined && tabletsPerStrip !== "" && nextTps == null) {
      return res.status(400).json({ error: "tabletsPerStrip must be a positive whole number" });
    }
    const hasUnitEdits =
      Object.values(explicit).some((v) => v !== undefined) || nextSpb != null || nextTps != null;
    if (hasUnitEdits && !existing.productId) {
      return res.status(400).json({ error: "This item is not linked to a product yet — save it first." });
    }

    const item = await prisma.$transaction(async (tx) => {
      if (hasUnitEdits) {
        const data = {};
        for (const key of ["tabletPrice", "stripPrice", "boxPrice"]) {
          if (explicit[key] !== undefined) data[key] = explicit[key];
        }
        if (nextSpb != null) data.stripsPerBox = nextSpb;
        if (nextTps != null) data.tabletsPerStrip = nextTps;
        await tx.product.update({ where: { id: existing.productId }, data });
      }
      return tx.inventory.update({
        where: { id },
        data: {
          drugName: drugName != null ? (cleanString(drugName, 200) || existing.drugName) : existing.drugName,
          unitType: unitType ?? existing.unitType,
          quantity: quantity != null ? Number(quantity) : existing.quantity,
          costPrice: costPrice != null ? Number(costPrice) : existing.costPrice,
          sellingPrice: sellingPrice != null ? Number(sellingPrice) : existing.sellingPrice,
          expiryDate: expiryDate !== undefined ? (expiryDate ? new Date(expiryDate) : null) : existing.expiryDate,
          reorderLevel: reorderLevel != null ? Number(reorderLevel) : existing.reorderLevel,
        },
      });
    });
    res.json(item);
  } catch (err) {
    serverError(res, err);
  }
});

// Audit trail for one batch (restock/sale/adjustment history).
router.get("/:id/movements", async (req, res) => {
  try {
    const existing = await prisma.inventory.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.facilityId !== req.user.facilityId) {
      return res.status(404).json({ error: "Not found" });
    }
    const movements = await prisma.stockMovement.findMany({
      where: { inventoryId: existing.id },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(movements);
  } catch (err) {
    serverError(res, err);
  }
});

// Adjust stock (restock or decrement) — logs a StockMovement for audit.
router.post("/:id/adjust", requireRole("OWNER", "PHARMACIST"), async (req, res) => {
  try {
    const { id } = req.params;
    const { delta, costPrice, reason } = req.body;
    const existing = await prisma.inventory.findUnique({ where: { id } });
    if (!existing || existing.facilityId !== req.user.facilityId) {
      return res.status(404).json({ error: "Not found" });
    }
    // Whole units only — a fractional delta would silently round in the DB.
    const amount = Number(delta || 0);
    if (!Number.isInteger(amount) || amount === 0) {
      return res.status(400).json({ error: "delta must be a non-zero whole number" });
    }
    if (Math.abs(amount) > 1000000) {
      return res.status(400).json({ error: "That adjustment is too large." });
    }
    if (costPrice != null && toNonNegativeNumber(costPrice) == null) {
      return res.status(400).json({ error: "costPrice must be a non-negative number" });
    }
    const allowedReasons = ["RESTOCK", "ADJUSTMENT", "EXPIRED", "DAMAGED", "RETURN"];
    const movementReason =
      reason && allowedReasons.includes(reason) ? reason : amount > 0 ? "RESTOCK" : "ADJUSTMENT";
    const item = await prisma.inventory.update({
      where: { id },
      data: {
        quantity: Math.max(0, existing.quantity + amount),
        costPrice: costPrice != null ? Number(costPrice) : existing.costPrice,
      },
    });
    await prisma.stockMovement.create({
      data: {
        facilityId: req.user.facilityId,
        inventoryId: id,
        delta: amount,
        reason: movementReason,
        userId: req.user.sub || null,
      },
    });
    res.json(item);
  } catch (err) {
    serverError(res, err);
  }
});

// ----------  BUY A BOX (pack-based restock)  ----------
// Owner/Pharmacist buys boxes of a drug and ClinicSync breaks them into
// strips/tablets automagically using the product's pack composition, then
// sells single strips and single tablets from that same purchase.
// Request body:
//   productId, boxes (int), expiryDate, costPerBox, supplier?
router.post("/buy-pack", requireRole("OWNER", "PHARMACIST"), async (req, res) => {
  try {
    const { productId, boxes, expiryDate, costPerBox, supplier, batch } = req.body;
    const nBoxes = toPositiveInt(boxes);
    const costOfBox = toNonNegativeNumber(costPerBox ?? 0);
    if (!productId || nBoxes == null) {
      return res.status(400).json({ error: "productId and a positive whole number of boxes required" });
    }
    if (nBoxes > 100000) {
      return res.status(400).json({ error: "That is too many boxes for one restock." });
    }
    if (costOfBox == null) {
      return res.status(400).json({ error: "costPerBox must be a non-negative number" });
    }
    const product = await prisma.product.findFirst({
      where: { id: productId, facilityId: req.user.facilityId },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const stripsPerBox = product.stripsPerBox || 10;
    const tabletsPerStrip = product.tabletsPerStrip || 10;
    const costPerStrip = costOfBox / stripsPerBox;
    const costPerTablet = costPerStrip / tabletsPerStrip;

    // 1. Add box batch
    const boxItem = await prisma.inventory.create({
      data: {
        facilityId: req.user.facilityId,
        productId,
        drugName: product.name,
        unitType: "Box",
        quantity: nBoxes,
        costPrice: costOfBox,
        sellingPrice: product.boxPrice || costOfBox,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        supplier: supplier || null,
        batch: batch || null,
        reorderLevel: product.reorderBoxes ?? 5,
      },
    });
    await prisma.stockMovement.create({
      data: {
        facilityId: req.user.facilityId,
        inventoryId: boxItem.id,
        delta: nBoxes,
        reason: "RESTOCK",
        userId: req.user.sub || null,
      },
    });

    // 2. Add strip batch (if package has strips)
    let stripItem = null;
    if (stripsPerBox > 0) {
      stripItem = await prisma.inventory.create({
        data: {
          facilityId: req.user.facilityId,
          productId,
          drugName: product.name,
          unitType: "Strip of " + tabletsPerStrip,
          quantity: nBoxes * stripsPerBox,
          costPrice: Math.round(costPerStrip),
          sellingPrice: product.stripPrice || Math.round(costPerStrip),
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          supplier: supplier || null,
          batch: batch || null,
          reorderLevel: product.reorderStrips ?? 10,
        },
      });
    }

    // 3. Add tablet batch
    const tabletItem = await prisma.inventory.create({
      data: {
        facilityId: req.user.facilityId,
        productId,
        drugName: product.name,
        unitType: "Tablet",
        quantity: nBoxes * stripsPerBox * tabletsPerStrip,
        costPrice: Math.round(costPerTablet),
        sellingPrice: product.tabletPrice || Math.round(costPerTablet),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        supplier: supplier || null,
        batch: batch || null,
        reorderLevel: product.reorderTablets ?? 50,
      },
    });

    // close out with context so the client knows the breakdown
    res.status(201).json({
      ok: true,
      productId,
      boxId: boxItem.id,
      stripId: stripItem ? stripItem.id : null,
      tabletId: tabletItem.id,
      boxes: nBoxes,
      strips: stripItem ? nBoxes * stripsPerBox : 0,
      tablets: nBoxes * stripsPerBox * tabletsPerStrip,
      stripsPerBox,
      tabletsPerStrip,
    });
  } catch (err) {
    serverError(res, err);
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
    serverError(res, err);
  }
});

export default router;