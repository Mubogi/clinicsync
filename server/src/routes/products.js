import { Router } from "express";

import { prisma } from "../db.js";
import { requireRole } from "../auth.js";

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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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

    // If they bought a box and gave composition, compute strip/tablet sell prices
    // when not explicitly provided.
    let computedTablet = tabletPrice != null ? Number(tabletPrice) : null;
    let computedStrip = stripPrice != null ? Number(stripPrice) : null;
    const computedBox = boxPrice != null ? Number(boxPrice) : null;

    if (stripsPerBox && computedStrip == null && computedBox != null) {
      computedStrip = Math.max(1, Math.ceil(computedBox / Number(stripsPerBox) / 100) * 100);
    }
    if (tabletsPerStrip && computedTablet == null && computedStrip != null) {
      computedTablet = Math.max(1, Math.ceil(computedStrip / Number(tabletsPerStrip) / 50) * 50);
    }

    const product = await prisma.product.create({
      data: {
        facilityId: req.user.facilityId,
        name,
        genericName: genericName || null,
        tabletPrice: computedTablet,
        stripPrice: computedStrip,
        boxPrice: computedBox,
        costPrice: Number(costPrice || 0),
        stripsPerBox: stripsPerBox ? Number(stripsPerBox) : null,
        tabletsPerStrip: tabletsPerStrip ? Number(tabletsPerStrip) : null,
      },
    });
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
        name: name ?? product.name,
        genericName: genericName !== undefined ? genericName : product.genericName,
        tabletPrice: tabletPrice != null ? Number(tabletPrice) : product.tabletPrice,
        stripPrice: stripPrice != null ? Number(stripPrice) : product.stripPrice,
        boxPrice: boxPrice != null ? Number(boxPrice) : product.boxPrice,
        costPrice: costPrice != null ? Number(costPrice) : product.costPrice,
        stripsPerBox: stripsPerBox != null ? Number(stripsPerBox) : product.stripsPerBox,
        tabletsPerStrip: tabletsPerStrip != null ? Number(tabletsPerStrip) : product.tabletsPerStrip,
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
    res.status(500).json({ error: err.message });
  }
});

// Owner-only delete product
router.delete("/:id", requireRole("OWNER"), async (req, res) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, facilityId: req.user.facilityId },
    });
    if (!product) return res.status(404).json({ error: "Not found" });
    await prisma.product.delete({ where: { id: product.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { router, UNIT_TYPES };
export default router;