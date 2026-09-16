import { Router } from "express";

import { prisma } from "../db.js";
import { requireRole } from "../auth.js";
import { serverError, toNonNegativeNumber, toPositiveInt, cleanString } from "../http.js";

const router = Router();

const UNIT_TYPES = ["Tablet", "Strip of 10", "Strip of 6", "Bottle", "Box", "Sachet"];

// List products for this facility (plus computed prices per unit where present)
router.get("/", async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim().toLowerCase();
    const products = await prisma.product.findMany({
      where: {
        facilityId: req.user.facilityId,
        ...(q
          ? { name: { contains: q, mode: "insensitive" } }
          : {}),
      },
      include: {
        inventories: { select: { id: true, unitType: true, quantity: true, sellingPrice: true, expiryDate: true } },
      },
      orderBy: { name: "asc" },
    });
    res.json(products);
  } catch (err) {
    serverError(res, err);
  }
});

// Get one product with stock batches
router.get("/:id", async (req, res) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, facilityId: req.user.facilityId },
      include: { inventories: { orderBy: { createdAt: "asc" } } },
    });
    if (!product) return res.status(404).json({ error: "Not found" });
    res.json(product);
  } catch (err) {
    serverError(res, err);
  }
});

// Owner/Pharmacist creates a product (catalog) with per-unit prices
router.post("/", requireRole("OWNER", "PHARMACIST"), async (req, res) => {
  try {
    const {
      name,
      genericName,
      tabletPrice,
      stripPrice,
      boxPrice,
      costPrice,
      stripsPerBox,
      tabletsPerStrip,
    } = req.body;

    if (!name) return res.status(400).json({ error: "name required" });
    const cleanName = cleanString(name, 200);
    if (!cleanName) return res.status(400).json({ error: "name required" });

    // Prices must be finite and non-negative; NaN/Infinity/negatives would
    // otherwise be stored and later corrupt sales totals and profit reports.
    const priceFields = { tabletPrice, stripPrice, boxPrice, costPrice };
    const prices = {};
    for (const [k, v] of Object.entries(priceFields)) {
      if (v == null || v === "") { prices[k] = null; continue; }
      const n = toNonNegativeNumber(v);
      if (n == null) return res.status(400).json({ error: `${k} must be a non-negative number` });
      prices[k] = n;
    }
    const spb = toPositiveInt(stripsPerBox);
    const tps = toPositiveInt(tabletsPerStrip);

    // If they bought a box and gave composition, compute strip/tablet sell prices
    // when not explicitly provided.
    let computedTablet = prices.tabletPrice;
    let computedStrip = prices.stripPrice;
    const computedBox = prices.boxPrice;

    if (spb && computedStrip == null && computedBox != null) {
      computedStrip = Math.max(1, Math.ceil(computedBox / spb / 100) * 100);
    }
    if (tps && computedTablet == null && computedStrip != null) {
      computedTablet = Math.max(1, Math.ceil(computedStrip / tps / 50) * 50);
    }

    const product = await prisma.product.create({
      data: {
        facilityId: req.user.facilityId,
        name: cleanName,
        genericName: cleanString(genericName, 200),
        tabletPrice: computedTablet,
        stripPrice: computedStrip,
        boxPrice: computedBox,
        costPrice: prices.costPrice ?? 0,
        stripsPerBox: spb,
        tabletsPerStrip: tps,
      },
    });
    res.status(201).json(product);
  } catch (err) {
    serverError(res, err);
  }
});

// Owner updates product prices (records price history + expected-revenue change)
router.patch("/:id", requireRole("OWNER", "PHARMACIST"), async (req, res) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findFirst({
      where: { id, facilityId: req.user.facilityId },
    });
    if (!product) return res.status(404).json({ error: "Not found" });

    const { name, genericName, tabletPrice, stripPrice, boxPrice, costPrice, stripsPerBox, tabletsPerStrip } = req.body;

    // Validate any supplied price before it can reach the database.
    const numeric = { tabletPrice, stripPrice, boxPrice, costPrice };
    for (const [k, v] of Object.entries(numeric)) {
      if (v == null) continue;
      if (toNonNegativeNumber(v) == null) {
        return res.status(400).json({ error: `${k} must be a non-negative number` });
      }
    }
    if (stripsPerBox != null && toPositiveInt(stripsPerBox) == null) {
      return res.status(400).json({ error: "stripsPerBox must be a positive whole number" });
    }
    if (tabletsPerStrip != null && toPositiveInt(tabletsPerStrip) == null) {
      return res.status(400).json({ error: "tabletsPerStrip must be a positive whole number" });
    }

    const history = [];
    if (costPrice != null && Number(costPrice) !== product.costPrice) {
      history.push({ oldSell: product.costPrice, newSell: Number(costPrice) }); // cost tracked in oldSell for simplicity
    }
    if (tabletPrice != null && Number(tabletPrice) !== product.tabletPrice) {
      history.push({ oldSell: product.tabletPrice, newSell: Number(tabletPrice) });
    }
    if (stripPrice != null && Number(stripPrice) !== product.stripPrice) {
      history.push({ oldSell: product.stripPrice, newSell: Number(stripPrice) });
    }
    if (boxPrice != null && Number(boxPrice) !== product.boxPrice) {
      history.push({ oldSell: product.boxPrice, newSell: Number(boxPrice) });
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        name: name != null ? (cleanString(name, 200) || product.name) : product.name,
        genericName: genericName !== undefined ? cleanString(genericName, 200) : product.genericName,
        tabletPrice: tabletPrice != null ? Number(tabletPrice) : product.tabletPrice,
        stripPrice: stripPrice != null ? Number(stripPrice) : product.stripPrice,
        boxPrice: boxPrice != null ? Number(boxPrice) : product.boxPrice,
        costPrice: costPrice != null ? Number(costPrice) : product.costPrice,
        stripsPerBox: stripsPerBox != null ? toPositiveInt(stripsPerBox) : product.stripsPerBox,
        tabletsPerStrip: tabletsPerStrip != null ? toPositiveInt(tabletsPerStrip) : product.tabletsPerStrip,
      },
    });

    // Log price history (one row per changed field)
    for (const h of history) {
      await prisma.priceHistory.create({
        data: {
          facilityId: req.user.facilityId,
          productId: id,
          oldCost: product.costPrice,
          newCost: costPrice != null ? Number(costPrice) : product.costPrice,
          oldSell: h.oldSell,
          newSell: h.newSell,
          changedBy: req.user.sub,
        },
      });
    }

    res.json(updated);
  } catch (err) {
    serverError(res, err);
  }
});

// Owner-only delete product
router.delete("/:id", requireRole("OWNER"), async (req, res) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, facilityId: req.user.facilityId },
    });
    if (!product) return res.status(404).json({ error: "Not found" });

    // Stock batches still point at this product (FK). Detach them rather than
    // failing with a raw constraint error — existing stock stays sellable, just
    // without the catalogue link.
    await prisma.$transaction([
      prisma.inventory.updateMany({
        where: { facilityId: req.user.facilityId, productId: product.id },
        data: { productId: null },
      }),
      prisma.priceHistory.deleteMany({ where: { productId: product.id } }),
      prisma.product.delete({ where: { id: product.id } }),
    ]);
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err);
  }
});

export { router, UNIT_TYPES };
export default router;