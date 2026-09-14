import { Router } from "express";

import { prisma } from "../db.js";

const router = Router();

// Owner portal stats: revenue trend, expenses, low stock, top drugs
router.get("/", async (req, res) => {
  try {
    const facilityId = req.user.facilityId;
    const days = Math.min(Number(req.query.days) || 30, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [sales, expenses, inventory, reconciliation] = await Promise.all([
      prisma.sale.findMany({
        where: { facilityId, createdAt: { gte: since } },
        include: { items: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.expense.findMany({
        where: { facilityId, createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.inventory.findMany({ where: { facilityId } }),
      prisma.dailyReconciliation.findMany({
        where: { facilityId, date: { gte: since } },
        orderBy: { date: "asc" },
      }),
    ]);

    const key = (d) => {
      const x = new Date(d);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    };

    const revenueByDay = {};
    const expensesByDay = {};
    for (const s of sales) {
      const k = key(s.createdAt);
      revenueByDay[k] = (revenueByDay[k] || 0) + s.totalAmount;
    }
    for (const e of expenses) {
      const k = key(e.createdAt);
      expensesByDay[k] = (expensesByDay[k] || 0) + e.amount;
    }

    const drugSales = {};
    for (const s of sales) {
      for (const it of s.items) {
        drugSales[it.drugName] = (drugSales[it.drugName] || 0) + it.totalPrice;
      }
    }
    const topDrugs = Object.entries(drugSales)
      .map(([drugName, total]) => ({ drugName, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    const lowStock = inventory.filter((i) => i.quantity <= i.reorderLevel);

    res.json({
      rangeDays: days,
      totalRevenue: sales.reduce((s, x) => s + x.totalAmount, 0),
      totalSales: sales.length,
      totalExpenses: expenses.reduce((s, x) => s + x.amount, 0),
      momoRevenue: sales.reduce((s, x) => s + (x.momoPaid || 0), 0),
      cashRevenue: sales.reduce((s, x) => s + (x.cashPaid || 0), 0),
      netRevenue: sales.reduce((s, x) => s + x.totalAmount, 0) - expenses.reduce((s, x) => s + x.amount, 0),
      revenueByDay,
      expensesByDay,
      topDrugs,
      lowStock,
      reconciliation,
      inventoryValue: inventory.reduce((s, i) => s + i.quantity * i.costPrice, 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;