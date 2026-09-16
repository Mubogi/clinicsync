import { Router } from "express";
import express from "express";

import { prisma } from "../db.js";
import { requireRole } from "../auth.js";
import {
  buildFacilitySnapshot,
  serialiseSnapshot,
  parseSnapshot,
  checksumOf,
  backupFilename,
  restoreFacilitySnapshot,
  storeBackup,
} from "../backup.js";
import { serverError, safeBadRequest } from "../http.js";

const router = Router();

// Backups are owner-only and always scoped to the caller's own facility: the
// facilityId comes from the verified session, never from the request body.

// List stored backups (metadata only — payloads are not sent to the browser).
router.get("/", requireRole("OWNER"), async (req, res) => {
  try {
    const backups = await prisma.backup.findMany({
      where: { facilityId: req.user.facilityId },
      select: { id: true, label: true, kind: true, sizeBytes: true, checksum: true, createdAt: true, createdBy: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(backups);
  } catch (err) {
    serverError(res, err);
  }
});

// Download a fresh, point-in-time backup file (no DB row required).
router.get("/download", requireRole("OWNER"), async (req, res) => {
  try {
    const snapshot = await buildFacilitySnapshot(req.user.facilityId);
    const bytes = serialiseSnapshot(snapshot);
    const name = backupFilename(snapshot.facility?.name, snapshot.generatedAt);
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("X-Backup-Checksum", checksumOf(snapshot));
    res.setHeader("Cache-Control", "no-store");
    res.send(bytes);
  } catch (err) {
    serverError(res, err);
  }
});

// Create + store a backup on the server (used by the monthly job and the UI).
router.post("/", requireRole("OWNER"), async (req, res) => {
  try {
    const { label, kind } = req.body || {};
    const { row, snapshot, bytes } = await storeBackup(req.user.facilityId, {
      label,
      kind: kind === "MONTHLY" ? "MONTHLY" : "MANUAL",
      createdBy: req.user.sub,
    });
    res.status(201).json({
      id: row.id,
      label: row.label,
      kind: row.kind,
      sizeBytes: bytes.length,
      checksum: row.checksum,
      createdAt: row.createdAt,
      filename: backupFilename(snapshot.facility?.name, snapshot.generatedAt),
      counts: {
        users: snapshot.users.length,
        products: snapshot.products.length,
        inventory: snapshot.inventory.length,
        sales: snapshot.sales.length,
      },
    });
  } catch (err) {
    serverError(res, err);
  }
});

// Download a previously stored backup by id.
router.get("/:id/download", requireRole("OWNER"), async (req, res) => {
  try {
    const row = await prisma.backup.findFirst({
      where: { id: req.params.id, facilityId: req.user.facilityId },
    });
    if (!row) return res.status(404).json({ error: "Backup not found" });
    const bytes = serialiseSnapshot(row.payload);
    const name = backupFilename(row.payload?.facility?.name, row.createdAt);
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("X-Backup-Checksum", row.checksum || "");
    res.setHeader("Cache-Control", "no-store");
    res.send(bytes);
  } catch (err) {
    serverError(res, err);
  }
});

router.delete("/:id", requireRole("OWNER"), async (req, res) => {
  try {
    const row = await prisma.backup.findFirst({
      where: { id: req.params.id, facilityId: req.user.facilityId },
    });
    if (!row) return res.status(404).json({ error: "Backup not found" });
    await prisma.backup.delete({ where: { id: row.id } });
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err);
  }
});

// Restore from an uploaded backup file. Accepts raw .json.gz bytes.
// Owners only, and the target facility is always the caller's own.
router.post(
  "/restore",
  requireRole("OWNER"),
  express.raw({ type: ["application/gzip", "application/octet-stream", "application/json"], limit: "64mb" }),
  async (req, res) => {
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
      if (!body.length) {
        return res.status(400).json({ error: "No backup file uploaded." });
      }
      const snapshot = parseSnapshot(body);
      const stats = await restoreFacilitySnapshot(req.user.facilityId, snapshot, {
        restoredBy: req.user.sub,
      });
      res.json({
        ok: true,
        restoredFrom: snapshot.generatedAt,
        counts: stats,
        facility: {
          name: snapshot.facility.name,
          brandName: snapshot.facility.brandName || snapshot.facility.name,
        },
      });
    } catch (err) {
      safeBadRequest(res, err);
    }
  }
);

// Restore from a backup already stored on the server.
router.post("/:id/restore", requireRole("OWNER"), async (req, res) => {
  try {
    const row = await prisma.backup.findFirst({
      where: { id: req.params.id, facilityId: req.user.facilityId },
    });
    if (!row) return res.status(404).json({ error: "Backup not found" });
    const stats = await restoreFacilitySnapshot(req.user.facilityId, row.payload, {
      restoredBy: req.user.sub,
    });
    res.json({ ok: true, restoredFrom: row.createdAt, counts: stats });
  } catch (err) {
    safeBadRequest(res, err);
  }
});

// Integrity check: does the stored payload still hash to its recorded checksum?
router.get("/:id/verify", requireRole("OWNER"), async (req, res) => {
  try {
    const row = await prisma.backup.findFirst({
      where: { id: req.params.id, facilityId: req.user.facilityId },
    });
    if (!row) return res.status(404).json({ error: "Backup not found" });
    const actual = checksumOf(row.payload);
    res.json({ id: row.id, intact: !row.checksum || actual === row.checksum, checksum: actual });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;