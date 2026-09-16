import { Router } from "express";

import { prisma } from "../db.js";
import { serverError } from "../http.js";

const router = Router();

function dateKey(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Build the day's summary (sales, expenses, momo, cash, drugs bought)
async function buildSummary(facilityId, dayStart, dayEnd) {
  const [sales, expenses] = await Promise.all([
    prisma.sale.findMany({
      where: { facilityId, createdAt: { gte: dayStart, lte: dayEnd } },
    }),
    prisma.expense.findMany({
      where: { facilityId, createdAt: { gte: dayStart, lte: dayEnd } },
    }),
  ]);

  const totalRevenue = sales.reduce((s, x) => s + x.totalAmount, 0);
  const cashRevenue = sales.reduce((s, x) => s + (x.cashPaid || 0), 0);
  const momoRevenue = sales.reduce((s, x) => s + (x.momoPaid || 0), 0);
  const momoMtn = sales.filter((x) => x.momoNetwork === "MTN").reduce((s, x) => s + (x.momoPaid || 0), 0);
  const momoAirtel = sales.filter((x) => x.momoNetwork === "AIRTEL").reduce((s, x) => s + (x.momoPaid || 0), 0);

  const totalExpenses = expenses.reduce((s, x) => s + x.amount, 0);
  const drugsBoughtTotal = expenses
    .filter((x) => x.category === "Wholesale Restock (Drugs Bought)")
    .reduce((s, x) => s + x.amount, 0);

  const expectedCash = cashRevenue - totalExpenses + drugsBoughtTotal;

  return {
    date: dateKey(dayStart),
    totalRevenue,
    totalExpenses,
    expectedCash,
    momoBalance: momoRevenue,
    momoMtn,
    momoAirtel,
    drugsBoughtTotal,
    salesCount: sales.length,
  };
}

// Get summary for a given day (defaults to today)
async function summaryForDay(facilityId, date) {
  const d = date ? new Date(date) : new Date();
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  const summary = await buildSummary(facilityId, dayStart, dayEnd);

  const existing = await prisma.dailyReconciliation.findFirst({
    where: { facilityId, date: { lte: dayEnd, gte: dayStart } },
  });

  return { ...summary, isClosed: existing?.isClosed || false, reconciliationId: existing?.id || null };
}

router.get("/summary", async (req, res) => {
  try {
    res.json(await summaryForDay(req.user.facilityId, req.query.date));
  } catch (err) {
    serverError(res, err);
  }
});

// Alias used by the POS "End of Day" screen — always today, ignoring date params.
router.get("/today", async (req, res) => {
  try {
    res.json(await summaryForDay(req.user.facilityId));
  } catch (err) {
    serverError(res, err);
  }
});

// Weekly / monthly transaction + revenue report. Periods are aligned to the
// facility's local calendar (week starts Monday) so totals match the shift
// close-outs the owner signs off on.
router.get("/report", async (req, res) => {
  try {
    const period = String(req.query.period || "weekly").toLowerCase();
    const now = new Date();
    let start;
    let label;

    if (period === "monthly") {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      label = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    } else {
      const dow = (now.getDay() + 6) % 7; // Monday = 0
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow, 0, 0, 0);
      label = `week-of-${dateKey(start)}`;
    }
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const sales = await prisma.sale.findMany({
      where: { facilityId: req.user.facilityId, createdAt: { gte: start, lte: end } },
    });
    const expenses = await prisma.expense.findMany({
      where: { facilityId: req.user.facilityId, createdAt: { gte: start, lte: end } },
    });

    const days = {};
    for (const s of sales) {
      const k = dateKey(s.createdAt);
      days[k] = days[k] || { date: k, revenue: 0, cash: 0, momo: 0, salesCount: 0 };
      days[k].revenue += s.totalAmount;
      days[k].cash += s.cashPaid || 0;
      days[k].momo += s.momoPaid || 0;
      days[k].salesCount += 1;
    }

    const totalRevenue = sales.reduce((s, x) => s + x.totalAmount, 0);
    const totalExpenses = expenses.reduce((s, x) => s + x.amount, 0);
    const perCashier = {};
    for (const s of sales) {
      const who = s.cashierName || "Unassigned";
      perCashier[who] = perCashier[who] || { cashier: who, revenue: 0, salesCount: 0 };
      perCashier[who].revenue += s.totalAmount;
      perCashier[who].salesCount += 1;
    }

    res.json({
      period,
      label,
      from: start,
      to: end,
      totalRevenue,
      totalExpenses,
      net: totalRevenue - totalExpenses,
      salesCount: sales.length,
      averageSale: sales.length ? Math.round(totalRevenue / sales.length) : 0,
      days: Object.values(days).sort((a, b) => a.date.localeCompare(b.date)),
      perCashier: Object.values(perCashier).sort((a, b) => b.revenue - a.revenue),
    });
  } catch (err) {
    serverError(res, err);
  }
});

// Lock (close) shift: create/finalize the daily reconciliation
router.post("/lock", async (req, res) => {
  try {
    const d = req.query.date ? new Date(req.query.date) : new Date();
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

    const summary = await buildSummary(req.user.facilityId, dayStart, dayEnd);

    const existing = await prisma.dailyReconciliation.findFirst({
      where: { facilityId: req.user.facilityId, date: { lte: dayEnd, gte: dayStart } },
    });

    const data = {
      facilityId: req.user.facilityId,
      date: dayStart,
      totalRevenue: summary.totalRevenue,
      totalExpenses: summary.totalExpenses,
      expectedCash: summary.expectedCash,
      momoBalance: summary.momoBalance,
      drugsBoughtTotal: summary.drugsBoughtTotal,
      isClosed: true,
    };

    const rec = existing
      ? await prisma.dailyReconciliation.update({ where: { id: existing.id }, data })
      : await prisma.dailyReconciliation.create({ data });

    res.json({ ...summary, isClosed: true, reconciliationId: rec.id });
  } catch (err) {
    serverError(res, err);
  }
});

// List past reconciliations
router.get("/history", async (req, res) => {
  try {
    const recs = await prisma.dailyReconciliation.findMany({
      where: { facilityId: req.user.facilityId },
      orderBy: { date: "desc" },
      take: 90,
    });
    res.json(recs);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;