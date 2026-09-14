import { Router } from "express";

import { prisma } from "../db.js";

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
router.get("/summary", async (req, res) => {
  try {
    const d = req.query.date ? new Date(req.query.date) : new Date();
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
    const summary = await buildSummary(req.user.facilityId, dayStart, dayEnd);

    const existing = await prisma.dailyReconciliation.findFirst({
      where: { facilityId: req.user.facilityId, date: { lte: dayEnd, gte: dayStart } },
    });

    res.json({ ...summary, isClosed: existing?.isClosed || false, reconciliationId: existing?.id || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

export default router;