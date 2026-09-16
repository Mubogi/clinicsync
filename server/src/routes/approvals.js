import { Router } from "express";

import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { serverError } from "../http.js";

const router = Router();

// ----------  DELETE APPROVAL WORKFLOW  ----------
// Owners can delete a sale/expense directly (no approval needed).
// Other roles request a delete with a reason; the owner approves or rejects.

async function findTarget(kind, id, facilityId) {
  if (kind === "SALE") {
    return prisma.sale.findFirst({ where: { id, facilityId } });
  }
  if (kind === "EXPENSE") {
    return prisma.expense.findFirst({ where: { id, facilityId } });
  }
  return null;
}

async function deleteTarget(kind, id, facilityId) {
  if (kind === "SALE") {
    const sale = await prisma.sale.findFirst({ where: { id, facilityId }, include: { items: true } });
    if (!sale) return false;
    await prisma.saleItem.deleteMany({ where: { saleId: id } });
    await prisma.sale.delete({ where: { id } });
    // restore stock for deleted sale items (only if inventory still exists)
    for (const it of sale.items) {
      if (it.inventoryId) {
        const inv = await prisma.inventory.findUnique({ where: { id: it.inventoryId } });
        if (inv) {
          await prisma.inventory.update({
            where: { id: inv.id },
            data: { quantity: { increment: it.quantity } },
          });
          await prisma.stockMovement.create({
            data: {
              facilityId,
              inventoryId: inv.id,
              delta: it.quantity,
              reason: "DELETE_RESTORE",
              userId: null,
            },
          });
        }
      }
    }
    return true;
  }
  if (kind === "EXPENSE") {
    const expense = await prisma.expense.findFirst({ where: { id, facilityId } });
    if (!expense) return false;
    await prisma.expense.delete({ where: { id } });
    return true;
  }
  return false;
}

// Owners delete directly
router.delete("/:kind/:id", requireAuth, requireRole("OWNER"), async (req, res) => {
  try {
    const kind = String(req.params.kind).toUpperCase();
    const ok = await deleteTarget(kind, req.params.id, req.user.facilityId);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err);
  }
});

// Non-owner staff request deletion with a reason
router.post("/request", requireAuth, async (req, res) => {
  try {
    if (req.user.role === "OWNER") {
      return res.status(403).json({ error: "Owners delete directly — no approval needed." });
    }
    const { kind, id, reason } = req.body;
    if (!kind || !id || !reason || !String(reason).trim()) {
      return res.status(400).json({ error: "kind, id and reason required" });
    }
    const target = await findTarget(String(kind).toUpperCase(), id, req.user.facilityId);
    if (!target) return res.status(404).json({ error: "Target not found" });

    // avoid duplicate pending requests
    const existing = await prisma.deleteRequest.findFirst({
      where: {
        facilityId: req.user.facilityId,
        kind: String(kind).toUpperCase(),
        targetId: id,
        status: "PENDING",
      },
    });
    if (existing) return res.status(409).json({ error: "A request for this item is already pending." });

    const request = await prisma.deleteRequest.create({
      data: {
        facilityId: req.user.facilityId,
        kind: String(kind).toUpperCase(),
        targetId: id,
        reason: String(reason).trim(),
        requestedBy: req.user.name,
        requestedById: req.user.sub,
      },
    });
    res.status(201).json(request);
  } catch (err) {
    serverError(res, err);
  }
});

// List pending delete requests (owner sees all; staff see their own)
router.get("/requests", requireAuth, async (req, res) => {
  try {
    const where = { facilityId: req.user.facilityId };
    if (req.user.role !== "OWNER") {
      where.requestedById = req.user.sub;
    }
    const requests = await prisma.deleteRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    res.json(requests);
  } catch (err) {
    serverError(res, err);
  }
});

// Owner approves a delete request → performs the delete.
router.post("/requests/:id/approve", requireAuth, requireRole("OWNER"), async (req, res) => {
  try {
    const request = await prisma.deleteRequest.findUnique({ where: { id: req.params.id } });
    if (!request || request.facilityId !== req.user.facilityId) {
      return res.status(404).json({ error: "Not found" });
    }
    if (request.status !== "PENDING") {
      return res.status(409).json({ error: "Request already resolved" });
    }
    const ok = await deleteTarget(request.kind, request.targetId, req.user.facilityId);
    if (!ok) {
      return res.status(404).json({ error: "Target no longer exists" });
    }
    const updated = await prisma.deleteRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED", approvedBy: req.user.name, approvedAt: new Date() },
    });
    res.json(updated);
  } catch (err) {
    serverError(res, err);
  }
});

// Owner rejects a delete request
router.post("/requests/:id/reject", requireAuth, requireRole("OWNER"), async (req, res) => {
  try {
    const request = await prisma.deleteRequest.findUnique({ where: { id: req.params.id } });
    if (!request || request.facilityId !== req.user.facilityId) {
      return res.status(404).json({ error: "Not found" });
    }
    if (request.status !== "PENDING") {
      return res.status(409).json({ error: "Request already resolved" });
    }
    const updated = await prisma.deleteRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", approvedBy: req.user.name, approvedAt: new Date() },
    });
    res.json(updated);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;