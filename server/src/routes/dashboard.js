import { Router } from "express";

import { prisma } from "../db.js";
import { getEffectiveTier, daysRemaining } from "../plans.js";
import { serverError } from "../http.js";

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

    const tierInfo = getEffectiveTier(facility);

    // ---- Weekly + monthly transaction/revenue reports ----
    const weekKey = (d) => {
      const x = new Date(d);
      const onejan = new Date(x.getFullYear(), 0, 1);
      const day = Math.floor((x - onejan) / (24 * 60 * 60 * 1000));
      const wk = Math.ceil((day + onejan.getDay() + 1) / 7);
      return `${x.getFullYear()}-W${String(wk).padStart(2, "0")}`;
    };
    const monthKey = (d) => {
      const x = new Date(d);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
    };

    const weekly = {};
    const monthly = {};
    for (const s of sales) {
      const wk = weekKey(s.createdAt);
      if (!weekly[wk]) weekly[wk] = { transactions: 0, revenue: 0, profit: 0, momo: 0, cash: 0 };
      weekly[wk].transactions += 1;
      weekly[wk].revenue += s.totalAmount;
      weekly[wk].profit += s.items.reduce((acc, it) => acc + (it.totalPrice - (it.costPrice || 0) * it.quantity), 0);
      weekly[wk].momo += s.momoPaid || 0;
      weekly[wk].cash += s.cashPaid || 0;

      const mk = monthKey(s.createdAt);
      if (!monthly[mk]) monthly[mk] = { transactions: 0, revenue: 0, profit: 0, momo: 0, cash: 0 };
      monthly[mk].transactions += 1;
      monthly[mk].revenue += s.totalAmount;
      monthly[mk].profit += s.items.reduce((acc, it) => acc + (it.totalPrice - (it.costPrice || 0) * it.quantity), 0);
      monthly[mk].momo += s.momoPaid || 0;
      monthly[mk].cash += s.cashPaid || 0;
    }
    for (const e of expenses) {
      const wk = weekKey(e.createdAt);
      if (weekly[wk]) weekly[wk].expenses = (weekly[wk].expenses || 0) + e.amount;
      const mk = monthKey(e.createdAt);
      if (monthly[mk]) monthly[mk].expenses = (monthly[mk].expenses || 0) + e.amount;
    }

    const weekList = Object.entries(weekly)
      .map(([period, v]) => ({ period, ...{ transactions: v.transactions, revenue: Math.round(v.revenue), profit: Math.round(v.profit || 0), momo: Math.round(v.momo), cash: Math.round(v.cash), expenses: Math.round(v.expenses || 0) } }))
      .sort((a, b) => a.period.localeCompare(b.period));
    const monthList = Object.entries(monthly)
      .map(([period, v]) => ({ period, ...{ transactions: v.transactions, revenue: Math.round(v.revenue), profit: Math.round(v.profit || 0), momo: Math.round(v.momo), cash: Math.round(v.cash), expenses: Math.round(v.expenses || 0) } }))
      .sort((a, b) => a.period.localeCompare(b.period));

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
      weekly: weekList,
      monthly: monthList,
      topDrugs,
      lowStock,
      expiringSoon,
      cashiers,
      reconciliation,
      inventoryValue: inventory.reduce((s, i) => s + i.quantity * i.costPrice, 0),
      tier: {
        key: tierInfo?.key || "BASIC",
        label: tierInfo?.label,
        maxUsers: tierInfo?.maxUsers,
        usersUsed: users.length,
        autoSync: tierInfo?.autoSync,
        // Surface billing state so the app can warn before a plan lapses
        // instead of the owner discovering it when features vanish.
        storedTier: tierInfo?.storedTier,
        expired: !!tierInfo?.expired,
        suspended: !!tierInfo?.suspended,
        daysRemaining: daysRemaining(facility),
      },
    });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;