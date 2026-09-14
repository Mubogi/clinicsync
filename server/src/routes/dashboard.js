import { Router } from "express";

import { prisma } from "../db.js";
import { getTier } from "../plans.js";

const router = Router();
const DAY = 24 * 60 * 60 * 1000;

// Owner portal stats: revenue trend, expenses, low stock, top drugs,
// per-cashier accountability, expected vs actual revenue, expiry alerts
router.get("/", async (req, res) => {
  try {
    const facilityId = req.user.facilityId;
    const days = Math.min(Number(req.query.days) || 30, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [sales, expenses, inventory, reconciliation, facility, users] = await Promise.all([
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
      prisma.facility.findUnique({ where: { id: facilityId } }),
      prisma.user.findMany({
        where: { facilityId },
        select: { id: true, name: true, role: true },
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

    // Top drugs — by revenue AND by units sold (so per-tablet shop analytics work)
    const drugRevenue = {};
    const drugQty = {};
    for (const s of sales) {
      for (const it of s.items) {
        drugRevenue[it.drugName] = (drugRevenue[it.drugName] || 0) + it.totalPrice;
        drugQty[it.drugName] = (drugQty[it.drugName] || 0) + it.quantity;
      }
    }
    const topDrugs = Object.entries(drugRevenue)
      .map(([drugName, total]) => ({
        drugName,
        total: Math.round(total),
        qty: drugQty[drugName] || 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    // Expected profit: (selling price − cost) per unit sold, using the snapshot
    let costOfGoods = 0;
    for (const s of sales) {
      for (const it of s.items) {
        costOfGoods += (it.costPrice || 0) * it.quantity;
      }
    }
    const totalRevenue = sales.reduce((s, x) => s + x.totalAmount, 0);
    const expectedProfit = Math.round(totalRevenue - costOfGoods);

    // Per-cashier accountability
    const cashierStats = {};
    for (const s of sales) {
      const name = s.cashierName || "Unknown";
      if (!cashierStats[name]) {
        cashierStats[name] = { name, sales: 0, revenue: 0, momo: 0, cash: 0 };
      }
      cashierStats[name].sales += 1;
      cashierStats[name].revenue += s.totalAmount;
      cashierStats[name].momo += s.momoPaid || 0;
      cashierStats[name].cash += s.cashPaid || 0;
    }
    const cashiers = Object.values(cashierStats)
      .map((c) => ({
        ...c,
        revenue: Math.round(c.revenue),
        momo: Math.round(c.momo),
        cash: Math.round(c.cash),
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Low stock + expiring soon (30 days)
    const lowStock = inventory.filter((i) => i.quantity <= i.reorderLevel);
    const expiringSoon = inventory
      .filter((i) => i.expiryDate && i.expiryDate < new Date(Date.now() + 30 * DAY) && i.quantity > 0)
      .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

    const tierInfo = getTier(facility?.subscriptionTier);

    res.json({
      rangeDays: days,
      totalRevenue,
      totalSales: sales.length,
      totalExpenses: expenses.reduce((s, x) => s + x.amount, 0),
      momoRevenue: sales.reduce((s, x) => s + (x.momoPaid || 0), 0),
      cashRevenue: sales.reduce((s, x) => s + (x.cashPaid || 0), 0),
      netRevenue: totalRevenue - expenses.reduce((s, x) => s + x.amount, 0),
      expectedProfit,
      costOfGoods,
      revenueByDay,
      expensesByDay,
      topDrugs,
      lowStock,
      expiringSoon,
      cashiers,
      reconciliation,
      inventoryValue: inventory.reduce((s, i) => s + i.quantity * i.costPrice, 0),
      tier: {
        key: facility?.subscriptionTier || "BASIC",
        label: tierInfo?.label,
        maxUsers: tierInfo?.maxUsers,
        usersUsed: users.length,
        autoSync: tierInfo?.autoSync,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;