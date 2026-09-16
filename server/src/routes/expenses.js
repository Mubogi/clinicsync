import { Router } from "express";

import { prisma } from "../db.js";
import { requireRole } from "../auth.js";
import { serverError, toNonNegativeNumber, cleanString } from "../http.js";

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
    serverError(res, err);
  }
});

// Create expense
router.post("/", async (req, res) => {
  try {
    const { category, amount, description } = req.body;
    if (!category || amount == null) {
      return res.status(400).json({ error: "category and amount required" });
    }
    const value = toNonNegativeNumber(amount);
    if (value == null) {
      return res.status(400).json({ error: "amount must be a non-negative number" });
    }
    const expense = await prisma.expense.create({
      data: {
        facilityId: req.user.facilityId,
        category: cleanString(category, 80) || "Other",
        amount: value,
        description: cleanString(description, 300),
      },
    });
    res.status(201).json(expense);
  } catch (err) {
    serverError(res, err);
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
    if (amount != null && toNonNegativeNumber(amount) == null) {
      return res.status(400).json({ error: "amount must be a non-negative number" });
    }
    const expense = await prisma.expense.update({
      where: { id },
      data: {
        category: category != null ? (cleanString(category, 80) || existing.category) : existing.category,
        amount: amount != null ? toNonNegativeNumber(amount) : existing.amount,
        description: description !== undefined ? cleanString(description, 300) : existing.description,
      },
    });
    res.json(expense);
  } catch (err) {
    serverError(res, err);
  }
});

// Delete expense — owners only. Staff must go through the approval workflow
// (/approvals/request with a reason), which is what the UI already prompts for.
router.delete("/:id", requireRole("OWNER"), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing || existing.facilityId !== req.user.facilityId) {
      return res.status(404).json({ error: "Not found" });
    }
    await prisma.expense.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;