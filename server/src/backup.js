import crypto from "node:crypto";
import zlib from "node:zlib";

import { prisma } from "./db.js";

// Bump when the snapshot shape changes so old files can still be recognised.
export const BACKUP_FORMAT = 2;

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const iso = (d) => (d ? new Date(d).toISOString() : null);

// Collect everything that belongs to one facility. Scoped by facilityId on
// every query so a backup can never contain another tenant's rows.
export async function buildFacilitySnapshot(facilityId) {
  const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
  if (!facility) throw new Error("Facility not found");

  const [users, products, priceHistory, inventory, stockMovements, sales, expenses, reconciliations, invites, deleteRequests] =
    await Promise.all([
      prisma.user.findMany({ where: { facilityId } }),
      prisma.product.findMany({ where: { facilityId } }),
      prisma.priceHistory.findMany({ where: { facilityId } }),
      prisma.inventory.findMany({ where: { facilityId } }),
      prisma.stockMovement.findMany({ where: { facilityId } }),
      prisma.sale.findMany({ where: { facilityId }, include: { items: true } }),
      prisma.expense.findMany({ where: { facilityId } }),
      prisma.dailyReconciliation.findMany({ where: { facilityId } }),
      prisma.facilityInvite.findMany({ where: { facilityId } }),
      prisma.deleteRequest.findMany({ where: { facilityId } }),
    ]);

  return {
    format: BACKUP_FORMAT,
    generatedAt: new Date().toISOString(),
    facility: {
      id: facility.id,
      name: facility.name,
      slug: facility.slug,
      subscriptionTier: facility.subscriptionTier,
      brandName: facility.brandName,
      tagline: facility.tagline,
      logoEmoji: facility.logoEmoji,
      address: facility.address,
      phone: facility.phone,
      onboarded: facility.onboarded,
      inviteCode: facility.inviteCode,
      createdAt: iso(facility.createdAt),
    },
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      pinCode: u.pinCode, // already bcrypt-hashed
      active: u.active,
      createdAt: iso(u.createdAt),
    })),
    products: products.map((p) => ({ ...p, createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt) })),
    priceHistory: priceHistory.map((p) => ({ ...p, createdAt: iso(p.createdAt) })),
    inventory: inventory.map((i) => ({ ...i, expiryDate: iso(i.expiryDate), createdAt: iso(i.createdAt), updatedAt: iso(i.updatedAt) })),
    stockMovements: stockMovements.map((m) => ({ ...m, createdAt: iso(m.createdAt) })),
    sales: sales.map((s) => ({
      ...s,
      createdAt: iso(s.createdAt),
      items: s.items.map((it) => ({ ...it })),
    })),
    expenses: expenses.map((e) => ({ ...e, createdAt: iso(e.createdAt) })),
    reconciliations: reconciliations.map((r) => ({ ...r, date: iso(r.date), createdAt: iso(r.createdAt) })),
    invites: invites.map((i) => ({ ...i, expiresAt: iso(i.expiresAt), createdAt: iso(i.createdAt) })),
    deleteRequests: deleteRequests.map((d) => ({ ...d, approvedAt: iso(d.approvedAt), createdAt: iso(d.createdAt) })),
  };
}

// Serialize a snapshot into the bytes the owner downloads.
export function serialiseSnapshot(snapshot) {
  const json = Buffer.from(JSON.stringify(snapshot), "utf8");
  return zlib.gzipSync(json, { level: 9 });
}

// Parse an uploaded backup. Throws a friendly error on anything malformed so
// the route can return 400 instead of a stack trace.
export function parseSnapshot(buffer) {
  let jsonBuf = buffer;
  // gzip magic bytes 1f 8b
  if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      jsonBuf = zlib.gunzipSync(buffer, { maxOutputLength: 64 * 1024 * 1024 });
    } catch {
      throw new Error("Backup file is corrupt or unreadable (gzip).");
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonBuf.toString("utf8"));
  } catch {
    throw new Error("Backup file is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || !parsed.facility || !Array.isArray(parsed.users)) {
    throw new Error("Backup file is missing required ClinicSync data.");
  }
  if (!parsed.format || Number(parsed.format) > BACKUP_FORMAT) {
    throw new Error("Backup file was created by a newer ClinicSync version.");
  }
  return parsed;
}

export function checksumOf(snapshot) {
  return sha256(Buffer.from(JSON.stringify(snapshot), "utf8"));
}

export function backupFilename(facilityName, generatedAt) {
  const safe = String(facilityName || "clinic")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "clinic";
  const stamp = new Date(generatedAt).toISOString().slice(0, 10);
  return `clinicsync-backup-${safe}-${stamp}.json.gz`;
}

// Restore a snapshot into an existing facility. Everything runs in one
// transaction: any failure rolls back so the live shop is never left half
// overwritten. A PRE_RESTORE backup of the current state is taken first so the
// owner can undo a bad restore.
export async function restoreFacilitySnapshot(facilityId, snapshot, { restoredBy } = {}) {
  const current = await buildFacilitySnapshot(facilityId);
  await prisma.backup.create({
    data: {
      facilityId,
      label: `Automatic safety copy before restore ${new Date().toISOString().slice(0, 16)}`,
      kind: "PRE_RESTORE",
      payload: current,
      sizeBytes: Buffer.byteLength(JSON.stringify(current)),
      checksum: checksumOf(current),
      createdBy: restoredBy || null,
    },
  });

  const facilityData = snapshot.facility || {};
  const users = snapshot.users || [];
  const sales = snapshot.sales || [];
  const inventory = snapshot.inventory || [];

  // Guard: a restore must never delete the last active owner, otherwise the
  // shop becomes permanently unreachable.
  const incomingOwners = users.filter((u) => u.role === "OWNER" && u.active !== false);
  if (incomingOwners.length === 0) {
    throw new Error("Backup contains no active OWNER — restoring would lock you out.");
  }

  const stats = { users: 0, products: 0, inventory: 0, sales: 0, expenses: 0, reconciliations: 0 };

  await prisma.$transaction(
    async (tx) => {
      // Wipe dependent rows first (deepest children first), scoped to facility.
      const saleIds = (await tx.sale.findMany({ where: { facilityId }, select: { id: true } })).map((s) => s.id);
      const invIds = (await tx.inventory.findMany({ where: { facilityId }, select: { id: true } })).map((i) => i.id);
      await tx.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
      await tx.stockMovement.deleteMany({ where: { facilityId } });
      await tx.sale.deleteMany({ where: { facilityId } });
      await tx.expense.deleteMany({ where: { facilityId } });
      await tx.dailyReconciliation.deleteMany({ where: { facilityId } });
      await tx.priceHistory.deleteMany({ where: { facilityId } });
      await tx.inventory.deleteMany({ where: { facilityId } });
      await tx.product.deleteMany({ where: { facilityId } });
      await tx.deleteRequest.deleteMany({ where: { facilityId } });
      await tx.facilityInvite.deleteMany({ where: { facilityId } });
      await tx.rememberToken.deleteMany({ where: { facilityId } });
      await tx.user.deleteMany({ where: { facilityId } });
      void invIds;

      await tx.facility.update({
        where: { id: facilityId },
        data: {
          name: facilityData.name,
          slug: facilityData.slug,
          subscriptionTier: facilityData.subscriptionTier || "BASIC",
          brandName: facilityData.brandName,
          tagline: facilityData.tagline,
          logoEmoji: facilityData.logoEmoji,
          address: facilityData.address,
          phone: facilityData.phone,
          onboarded: facilityData.onboarded ?? true,
        },
      });

      if (users.length) {
        await tx.user.createMany({
          data: users.map((u) => ({
            id: u.id,
            facilityId,
            name: u.name,
            role: u.role,
            pinCode: u.pinCode,
            active: u.active !== false,
            createdAt: u.createdAt ? new Date(u.createdAt) : new Date(),
          })),
          skipDuplicates: true,
        });
        stats.users = users.length;
      }

      if ((snapshot.products || []).length) {
        await tx.product.createMany({
          data: snapshot.products.map((p) => ({
            id: p.id,
            facilityId,
            name: p.name,
            genericName: p.genericName,
            tabletPrice: p.tabletPrice,
            stripPrice: p.stripPrice,
            boxPrice: p.boxPrice,
            costPrice: p.costPrice ?? 0,
            stripsPerBox: p.stripsPerBox,
            tabletsPerStrip: p.tabletsPerStrip,
            reorderTablets: p.reorderTablets,
            reorderStrips: p.reorderStrips,
            reorderBoxes: p.reorderBoxes,
          })),
          skipDuplicates: true,
        });
        stats.products = snapshot.products.length;
      }

      if (inventory.length) {
        await tx.inventory.createMany({
          data: inventory.map((i) => ({
            id: i.id,
            facilityId,
            productId: i.productId,
            drugName: i.drugName,
            unitType: i.unitType,
            quantity: i.quantity ?? 0,
            costPrice: i.costPrice ?? 0,
            sellingPrice: i.sellingPrice ?? 0,
            expiryDate: i.expiryDate ? new Date(i.expiryDate) : null,
            supplier: i.supplier,
            batch: i.batch,
            reorderLevel: i.reorderLevel ?? 10,
          })),
          skipDuplicates: true,
        });
        stats.inventory = inventory.length;
      }

      for (const s of sales) {
        await tx.sale.create({
          data: {
            id: s.id,
            facilityId,
            userId: s.userId,
            cashierName: s.cashierName,
            receiptNumber: s.receiptNumber ?? 0,
            totalAmount: s.totalAmount ?? 0,
            cashPaid: s.cashPaid ?? 0,
            momoPaid: s.momoPaid ?? 0,
            paymentMethod: s.paymentMethod || "CASH",
            momoNetwork: s.momoNetwork,
            createdAt: s.createdAt ? new Date(s.createdAt) : new Date(),
            items: {
              create: (s.items || []).map((it) => ({
                inventoryId: it.inventoryId,
                productId: it.productId,
                drugName: it.drugName,
                unitType: it.unitType,
                quantity: it.quantity ?? 0,
                unitPrice: it.unitPrice ?? 0,
                totalPrice: it.totalPrice ?? 0,
                costPrice: it.costPrice ?? 0,
              })),
            },
          },
        });
      }
      stats.sales = sales.length;

      if ((snapshot.expenses || []).length) {
        await tx.expense.createMany({
          data: snapshot.expenses.map((e) => ({
            id: e.id,
            facilityId,
            category: e.category,
            amount: e.amount ?? 0,
            description: e.description,
            createdAt: e.createdAt ? new Date(e.createdAt) : new Date(),
          })),
          skipDuplicates: true,
        });
        stats.expenses = snapshot.expenses.length;
      }

      if ((snapshot.reconciliations || []).length) {
        await tx.dailyReconciliation.createMany({
          data: snapshot.reconciliations.map((r) => ({
            id: r.id,
            facilityId,
            date: r.date ? new Date(r.date) : new Date(),
            totalRevenue: r.totalRevenue ?? 0,
            totalExpenses: r.totalExpenses ?? 0,
            expectedCash: r.expectedCash ?? 0,
            momoBalance: r.momoBalance ?? 0,
            drugsBoughtTotal: r.drugsBoughtTotal ?? 0,
            isClosed: !!r.isClosed,
          })),
          skipDuplicates: true,
        });
        stats.reconciliations = snapshot.reconciliations.length;
      }

      if ((snapshot.stockMovements || []).length) {
        await tx.stockMovement.createMany({
          data: snapshot.stockMovements
            .filter((m) => m.inventoryId)
            .map((m) => ({
              id: m.id,
              facilityId,
              inventoryId: m.inventoryId,
              delta: m.delta ?? 0,
              reason: m.reason || "RESTORE",
              userId: m.userId,
              createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
            })),
          skipDuplicates: true,
        });
      }
    },
    { timeout: 120000 }
  );

  // The restore rewrote the user table, so every existing session token may
  // point at a row that was replaced. Tokens are re-validated per request, so
  // re-issuing remember tokens is not needed — just report what happened.
  return stats;
}

// Persist a snapshot as a downloadable Backup row and return it.
export async function storeBackup(facilityId, { label, kind = "MANUAL", createdBy } = {}) {
  const snapshot = await buildFacilitySnapshot(facilityId);
  const bytes = serialiseSnapshot(snapshot);
  const row = await prisma.backup.create({
    data: {
      facilityId,
      label: label || null,
      kind,
      payload: snapshot,
      sizeBytes: bytes.length,
      checksum: checksumOf(snapshot),
      createdBy: createdBy || null,
    },
  });
  return { row, snapshot, bytes };
}

const MONTHLY_MS = 30 * 24 * 60 * 60 * 1000;

// Take an automatic MONTHLY backup for every facility that does not already
// have one from the current calendar month. Used by the scheduler in index.js
// so owners always have a recent restore point even if they never click
// "Backup now". Failures are logged and never abort the run for other clinics.
export async function runMonthlyBackups() {
  const facilities = await prisma.facility.findMany({ select: { id: true, name: true } });
  const results = [];

  for (const facility of facilities) {
    try {
      const recent = await prisma.backup.findFirst({
        where: {
          facilityId: facility.id,
          kind: "MONTHLY",
          createdAt: { gte: new Date(Date.now() - MONTHLY_MS) },
        },
        select: { id: true },
      });
      if (recent) {
        results.push({ facilityId: facility.id, skipped: true });
        continue;
      }
      const { row } = await storeBackup(facility.id, {
        kind: "MONTHLY",
        label: `Automatic ${new Date().toISOString().slice(0, 7)}`,
      });
      results.push({ facilityId: facility.id, backupId: row.id, skipped: false });
    } catch (err) {
      console.error(`[backup] monthly backup failed for ${facility.name}:`, err.message);
      results.push({ facilityId: facility.id, error: err.message });
    }
  }
  return results;
}