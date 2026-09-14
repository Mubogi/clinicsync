import { Router } from "express";

import { prisma } from "../db.js";

const router = Router();

export const EXPENSE_CATEGORIES = [
  "YAKA / Electricity",
  "Water",
  "Staff Allowance",
  "Transport",
  "Packaging",
  "Wholesale Restock (Drugs Bought)",
  "Internet / Data",
  "Rent",
  "Other",
];

router.get("/categories", (_req, res) => {
  res.json(EXPENSE_CATEGORIES);
});

// List expenses
router.get("/", async (req, res) => {
  try {
    const from = req.query.from;
    const to = req.query.to;
    const where = { facilityId: req.user.facilityId };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    const expenses = await prisma.expense.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(req.query.limit) || 100, 300),
    });
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create expense
router.post("/", async (req, res) => {
  try {
    const { category, amount, description } = req.body;
    if (!category || amount == null) {
      return res.status(400).json({ error: "category and amount required" });
    }
    const expense = await prisma.expense.create({
      data: {
        facilityId: req.user.facilityId,
        category,
        amount: Number(amount),
        description: description || null,
      },
    });
    res.status(201).json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update expense
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing || existing.facilityId !== req.user.facilityId) {
      return res.status(404).json({ error: "Not found" });
    }
    const { category, amount, description } = req.body;
    const expense = await prisma.expense.update({
      where: { id },
      data: {
        category: category ?? existing.category,
        amount: amount != null ? Number(amount) : existing.amount,
        description: description !== undefined ? description : existing.description,
      },
    });
    res.json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete expense
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing || existing.facilityId !== req.user.facilityId) {
      return res.status(404).json({ error: "Not found" });
    }
    await prisma.expense.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;