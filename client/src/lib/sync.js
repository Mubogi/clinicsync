import {
  salesDb,
  expensesDb,
  inventoryDb,
  getUnsynced,
  markSynced,
  saveDoc,
} from "./db.js";
import { apiFetch } from "./api.js";

let running = false;
let lastSyncAt = null;

function online() {
  return typeof navigator !== "undefined" && navigator.onLine === true;
}

function toCloudSale(local) {
  return {
    id: local._id,
    receiptNumber: local.receiptNumber,
    totalAmount: local.totalAmount,
    cashPaid: local.cashPaid,
    momoPaid: local.momoPaid,
    paymentMethod: local.paymentMethod,
    momoNetwork: local.momoNetwork,
    items: (local.items || []).map((it) => ({
      drugName: it.drugName,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      totalPrice: it.totalPrice,
    })),
    createdAt: local.createdAt,
  };
}

function toCloudExpense(local) {
  return {
    id: local._id,
    category: local.category,
    amount: local.amount,
    description: local.description,
    createdAt: local.createdAt,
  };
}

function toCloudInventory(local) {
  return {
    id: local._id,
    drugName: local.drugName,
    unitType: local.unitType,
    quantity: local.quantity,
    costPrice: local.costPrice,
    sellingPrice: local.sellingPrice,
    expiryDate: local.expiryDate,
    reorderLevel: local.reorderLevel,
    createdAt: local.createdAt,
  };
}

async function push() {
  const [sales, expenses, inventories] = await Promise.all([
    getUnsynced(salesDb),
    getUnsynced(expensesDb),
    getUnsynced(inventoryDb),
  ]);

  if (sales.length === 0 && expenses.length === 0 && inventories.length === 0) {
    return { pushed: 0 };
  }

  const res = await apiFetch("/sync/push", {
    method: "POST",
    body: JSON.stringify({
      sales: sales.map(toCloudSale),
      expenses: expenses.map(toCloudExpense),
      inventories: inventories.map(toCloudInventory),
    }),
  });

  await Promise.all([
    markSynced(salesDb, sales.map((s) => s._id)),
    markSynced(expensesDb, expenses.map((e) => e._id)),
    markSynced(inventoryDb, inventories.map((i) => i._id)),
  ]);

  return res;
}

async function pull() {
  const data = await apiFetch("/sync/pull?since=" + encodeURIComponent((lastSyncAt || new Date(0)).toISOString()));
  lastSyncAt = data.lastSync ? new Date(data.lastSync) : new Date();

  for (const s of data.sales || []) {
    await saveDoc(salesDb, {
      _id: s.id,
      receiptNumber: s.receiptNumber,
      totalAmount: s.totalAmount,
      cashPaid: s.cashPaid,
      momoPaid: s.momoPaid,
      paymentMethod: s.paymentMethod,
      momoNetwork: s.momoNetwork,
      items: s.items || [],
      createdAt: s.createdAt,
      synced: true,
    });
  }
  for (const e of data.expenses || []) {
    await saveDoc(expensesDb, {
      _id: e.id,
      category: e.category,
      amount: e.amount,
      description: e.description,
      createdAt: e.createdAt,
      synced: true,
    });
  }
  for (const it of data.inventories || []) {
    await saveDoc(inventoryDb, {
      _id: it.id,
      drugName: it.drugName,
      unitType: it.unitType,
      quantity: it.quantity,
      costPrice: it.costPrice,
      sellingPrice: it.sellingPrice,
      expiryDate: it.expiryDate,
      reorderLevel: it.reorderLevel,
      createdAt: it.createdAt,
      synced: true,
    });
  }
}

export async function runSync() {
  if (running) return { skipped: true };
  if (!online()) return { offline: true };
  running = true;
  try {
    await push();
    await pull();
    return { ok: true, at: new Date().toISOString() };
  } finally {
    running = false;
  }
}

export function getLastSync() {
  return lastSyncAt;
}

// Start the background sync interval (auto for PREMIUM/PRO tiers)
export function startSyncLoop({ intervalMs = 30000, auto = true } = {}) {
  if (!auto) return () => {};
  const id = setInterval(() => {
    if (online()) runSync().catch(() => {});
  }, intervalMs);
  return () => clearInterval(id);
}