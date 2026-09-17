// Stock arithmetic shared by the sales and offline-sync paths.
// Extracted so a sale replayed from the offline queue decrements stock by
// exactly the same rules as a live sale, including opening packs.

// How many tablets one of `unitType` contains. Expressing every unit in tablets
// lets a sale in one unit be satisfied from a batch stocked in another (sell a
// tablet from a box, a strip from a box, and so on). Returns 0 for units that
// have no defined relationship (Bottle, Sachet, unknown), which the caller
// treats as "only sellable as itself".
export function tabletsPerUnit(unitType, product) {
  const t = String(unitType || "").toLowerCase();
  if (t.startsWith("tablet")) return 1;
  if (t.startsWith("strip")) {
    // "Strip of 10" / "Strip of 6" carry their own size; fall back to the pack.
    const n = parseInt(t.replace(/[^0-9]/g, ""), 10);
    if (Number.isInteger(n) && n > 0) return n;
    return product?.tabletsPerStrip || 0;
  }
  if (t.startsWith("box")) {
    const spb = product?.stripsPerBox || 0;
    const tps = product?.tabletsPerStrip || 0;
    return spb > 0 && tps > 0 ? spb * tps : 0;
  }
  return 0;
}

// Sell `qty` of `sellUnit` out of `inv`, opening larger units when the sale
// does not divide evenly. A shop that stocks boxes but sells strips has stock
// of 5 boxes and wants to sell 2 strips: one box is opened, 2 strips go to the
// customer and the remaining 8 stay as stock. Keeping every stored quantity a
// whole number avoids fractional inventory, which would make counts and audits
// meaningless.
export async function takeFromStock(tx, { facilityId, inv, product, sellUnit, qty, userId }) {
  const sellPer = tabletsPerUnit(sellUnit, product);
  const invPer = tabletsPerUnit(inv.unitType, product);
  const simple = async (batchId, amount, batchUnit) => {
    await tx.inventory.update({
      where: { id: batchId },
      data: { quantity: { decrement: amount }, syncStatus: false },
    });
    await tx.stockMovement.create({
      data: { facilityId, inventoryId: batchId, delta: -amount, reason: "SALE", userId },
    });
    return { batchId, unitType: batchUnit };
  };

  // Same unit, or no defined relationship between them: decrement as-is.
  if (String(sellUnit) === String(inv.unitType) || sellPer <= 0 || invPer <= 0) {
    if (inv.quantity < qty) {
      throw new Error(`Insufficient stock for ${inv.drugName} (have ${inv.quantity})`);
    }
    return simple(inv.id, qty, inv.unitType);
  }

  // Exact conversion is possible without opening anything.
  const needed = (sellPer * qty) / invPer;
  if (Number.isInteger(needed)) {
    if (inv.quantity < needed) {
      throw new Error(
        `Insufficient stock for ${inv.drugName}: need ${needed} ${inv.unitType} for ${qty} ${sellUnit} (have ${inv.quantity})`
      );
    }
    return simple(inv.id, needed, inv.unitType);
  }

  // Converting down to a larger unit (e.g. buying boxes out of strips) cannot
  // be done by opening packs, so only an exact match is allowed.
  if (invPer <= sellPer) {
    throw new Error(
      `Cannot sell ${qty} × ${sellUnit} from stock kept in ${inv.unitType} (not a whole number of units)`
    );
  }
  if (invPer % sellPer !== 0) {
    throw new Error(`Cannot split ${inv.unitType} into ${sellUnit} — check the pack size`);
  }

  const perBatchUnit = invPer / sellPer;
  const unitsToOpen = Math.ceil(qty / perBatchUnit);
  if (inv.quantity < unitsToOpen) {
    throw new Error(
      `Insufficient stock for ${inv.drugName}: opening 1 ${inv.unitType} gives ${perBatchUnit} ${sellUnit}, ` +
        `so ${qty} ${sellUnit} needs ${unitsToOpen} ${inv.unitType} (have ${inv.quantity})`
    );
  }

  await tx.inventory.update({
    where: { id: inv.id },
    data: { quantity: { decrement: unitsToOpen }, syncStatus: false },
  });
  await tx.stockMovement.create({
    data: { facilityId, inventoryId: inv.id, delta: -unitsToOpen, reason: "SPLIT", userId },
  });

  const produced = unitsToOpen * perBatchUnit;
  const leftover = produced - qty;
  // Cost per smaller unit is derived from the pack, so margin stays correct.
  const unitCost = (inv.costPrice || 0) / perBatchUnit;
  // Price the opened stock at the catalog price for its unit when one exists,
  // otherwise inherit the batch price it came from.
  const openedPrice =
    {
      Tablet: product?.tabletPrice,
      "Strip of 10": product?.stripPrice,
      "Strip of 6": product?.stripPrice,
      Box: product?.boxPrice,
    }[sellUnit] ?? inv.sellingPrice;

  // The pack was exactly consumed by this sale: nothing is left to keep, so the
  // decrement already made on the source batch is the whole story.
  if (leftover === 0) {
    return { batchId: inv.id, unitType: sellUnit };
  }

  // Reuse an existing batch of the target unit with the same expiry, so
  // repeated singles sales do not litter the inventory with tiny batches.
  const existing = await tx.inventory.findFirst({
    where: {
      facilityId,
      productId: inv.productId,
      unitType: sellUnit,
      expiryDate: inv.expiryDate,
    },
  });

  let targetId;
  if (existing) {
    targetId = existing.id;
    await tx.inventory.update({
      where: { id: targetId },
      data: { quantity: { increment: produced }, syncStatus: false },
    });
  } else {
    const created = await tx.inventory.create({
      data: {
        facilityId,
        productId: inv.productId,
        drugName: inv.drugName,
        unitType: sellUnit,
        quantity: produced,
        costPrice: unitCost,
        sellingPrice: openedPrice,
        expiryDate: inv.expiryDate,
        supplier: inv.supplier,
        batch: inv.batch,
        reorderLevel: inv.reorderLevel,
      },
    });
    targetId = created.id;
  }

  // Credit the whole opened pack, then let the normal sale decrement take the
  // sold units back out — this keeps the movement trail auditable.
  await tx.stockMovement.create({
    data: { facilityId, inventoryId: targetId, delta: produced, reason: "SPLIT", userId },
  });
  return simple(targetId, qty, sellUnit);
}
