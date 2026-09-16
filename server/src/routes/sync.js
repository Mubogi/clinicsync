import { Router } from "express";

import { prisma } from "../db.js";
import { serverError } from "../http.js";

const router = Router();

const MAX_BATCH = 500;

// Pull: return all records with syncStatus=false (or all if ?full=1) that came from remote
// This is where the client posts its locally-created records marked syncStatus=false
router.post("/push", async (req, res) => {
  const { sales = [], expenses = [], inventories = [] } = req.body || {};
  const facilityId = req.user.facilityId;

  if (
    !Array.isArray(sales) || !Array.isArray(expenses) || !Array.isArray(inventories) ||
    sales.length > MAX_BATCH || expenses.length > MAX_BATCH || inventories.length > MAX_BATCH
  ) {
    return res.status(400).json({ error: `Each sync list must be an array of at most ${MAX_BATCH} records.` });
  }

  const pushed = { sales: 0, expenses: 0, inventories: 0 };

  await prisma.$transaction(async (tx) => {
    for (const s of sales) {
      if (!s.id || !s.items) continue;
      // A client-supplied id is only trusted for rows that already belong to
      // this facility. Otherwise a staff member could overwrite (and thereby
      // read or hijack) another clinic's sale by guessing its UUID.
      const existing = await tx.sale.findUnique({ where: { id: s.id } });
      if (existing) {
        if (existing.facilityId !== facilityId) continue;
        await tx.sale.update({ where: { id: s.id }, data: { syncStatus: true } });
        pushed.sales++;
        continue;
      }
      await tx.sale.create({
        data: {
          id: s.id,
          facilityId,
          userId: req.user.sub || null,
          cashierName: s.cashierName || null,
          receiptNumber: Number(s.receiptNumber) || 0,
          totalAmount: Number(s.totalAmount) || 0,
          cashPaid: Number(s.cashPaid) || 0,
          momoPaid: Number(s.momoPaid) || 0,
          paymentMethod: s.paymentMethod || "CASH",
          momoNetwork: s.momoNetwork || null,
          createdAt: s.createdAt ? new Date(s.createdAt) : new Date(),
          syncStatus: true,
          items: {
            create: (s.items || []).map((it) => ({
              inventoryId: it.inventoryId || undefined,
              productId: it.productId || undefined,
              drugName: it.drugName,
              unitType: it.unitType || null,
              quantity: Number(it.quantity) || 0,
              unitPrice: Number(it.unitPrice) || 0,
              totalPrice: Number(it.totalPrice) || 0,
              costPrice: Number(it.costPrice) || 0,
            })),
          },
        },
      });
      pushed.sales++;
    }

    for (const e of expenses) {
      if (!e.id) continue;
      const existing = await tx.expense.findUnique({ where: { id: e.id } });
      if (existing) {
        if (existing.facilityId !== facilityId) continue;
        await tx.expense.update({ where: { id: e.id }, data: { syncStatus: true } });
        pushed.expenses++;
        continue;
      }
      await tx.expense.create({
        data: {
          id: e.id,
          facilityId,
          category: e.category,
          amount: Number(e.amount) || 0,
          description: e.description || null,
          createdAt: e.createdAt ? new Date(e.createdAt) : new Date(),
          syncStatus: true,
        },
      });
      pushed.expenses++;
    }

    for (const it of inventories) {
      if (!it.id) continue;
      const existing = await tx.inventory.findUnique({ where: { id: it.id } });
      if (existing) {
        if (existing.facilityId !== facilityId) continue;
        await tx.inventory.update({ where: { id: it.id }, data: { syncStatus: true } });
        pushed.inventories++;
        continue;
      }
      await tx.inventory.create({
        data: {
          id: it.id,
          facilityId,
          productId: it.productId || undefined,
          drugName: it.drugName,
          unitType: it.unitType || "Strip",
          quantity: Number(it.quantity) || 0,
          costPrice: Number(it.costPrice) || 0,
          sellingPrice: Number(it.sellingPrice) || 0,
          expiryDate: it.expiryDate ? new Date(it.expiryDate) : null,
          reorderLevel: Number(it.reorderLevel) || 10,
          supplier: it.supplier || null,
          batch: it.batch || null,
          createdAt: it.createdAt ? new Date(it.createdAt) : new Date(),
          syncStatus: true,
        },
      });
      pushed.inventories++;
    }
  });

  res.json({ ok: true, pushed });
});

// Pull: fetch all remote cloud data so client can hydrate its local PouchDB
router.get("/pull", async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(0);
    const facilityId = req.user.facilityId;

    const [sales, expenses, inventories] = await Promise.all([
      prisma.sale.findMany({
        where: { facilityId, createdAt: { gte: since } },
        include: { items: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.expense.findMany({
        where: { facilityId, createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.inventory.findMany({
        where: { facilityId },
        orderBy: { updatedAt: "asc" },
      }),
    ]);

    res.json({
      lastSync: new Date().toISOString(),
      sales,
      expenses,
      inventories,
      facility: req.user.facilityId,
    });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;