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
    } = req.body;
    if (!drugName || !unitType || quantity == null || sellingPrice == null) {
      return res.status(400).json({ error: "drugName, unitType, quantity, sellingPrice required" });
    }
    // find-or-create a Product row for this drug name
    let product = await prisma.product.findFirst({
      where: { facilityId: req.user.facilityId, name: drugName },
    });
    if (!product) {
      product = await prisma.product.create({
        data: {
          facilityId: req.user.facilityId,
          name: drugName,
          genericName: null,
          tabletPrice: unitType === "Tablet" ? Number(sellingPrice) : null,
          stripPrice: unitType && unitType.toLowerCase().startsWith("strip") ? Number(sellingPrice) : null,
          boxPrice: packageUnit === "Box" ? Number(sellingPrice) : null,
          costPrice: Number(costPrice || 0),
          stripsPerBox: stripsPerBox || null,
          tabletsPerStrip: tabletsPerStrip || null,
        },
      });
    } else {
      // keep pack info in sync when user edits
      product = await prisma.product.update({
        where: { id: product.id },
        data: {
          stripsPerBox: stripsPerBox || product.stripsPerBox,
          tabletsPerStrip: tabletsPerStrip || product.tabletsPerStrip,
        },
      });
    }

    const item = await prisma.inventory.create({
      data: {
        facilityId: req.user.facilityId,
        productId: product.id,
        drugName,
        unitType,
        quantity: Number(quantity),
        costPrice: Number(costPrice || 0),
        sellingPrice: Number(sellingPrice),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        reorderLevel: Number(reorderLevel || 10),
      },
    });
    await prisma.stockMovement.create({
      data: {
        facilityId: req.user.facilityId,
        inventoryId: item.id,
        delta: Number(quantity),
        reason: "INITIAL",
        userId: req.user.sub || null,
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

// Adjust stock (restock or decrement) — logs a StockMovement for audit.
router.post("/:id/adjust", requireRole("OWNER", "PHARMACIST"), async (req, res) => {
  try {
    const { id } = req.params;
    const { delta, note, costPrice, reason } = req.body;
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
    if (amount !== 0) {
      await prisma.stockMovement.create({
        data: {
          facilityId: req.user.facilityId,
          inventoryId: id,
          delta: amount,
          reason: reason || (amount > 0 ? "RESTOCK" : "ADJUSTMENT"),
          userId: req.user.sub || null,
        },
      });
    }
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    if (!productId || !boxes || boxes <= 0) {
      return res.status(400).json({ error: "productId and positive boxes required" });
    }
    const product = await prisma.product.findFirst({
      where: { id: productId, facilityId: req.user.facilityId },
    });
    if (!product) return res.status(404).json({ error: "Product not found" });

    const nBoxes = Number(boxes);
    const stripsPerBox = product.stripsPerBox || 10;
    const tabletsPerStrip = product.tabletsPerStrip || 10;
    const costOfBox = Number(costPerBox || 0);
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