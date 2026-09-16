export const fmtMoney = (n) => {
  const num = Number(n || 0);
  return "UGX " + num.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

export const fmtShortMoney = (n) => {
  const num = Number(n || 0);
  return num.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

export const fmtDate = (iso) => {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(iso);
  }
};

export const fmtTime = (iso) => {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
};

export const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const initials = (name) =>
  (name || "?")
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export const TIERS = {
  BASIC: {
    label: "Basic",
    color: "#64748b",
    colorBadge: "bg-slate-100 text-slate-700",
    priceUgx: 0,
    maxUsers: 1,
    maxProducts: 50,
    maxFacilities: 1,
    autoSync: false,
    tagline: "Free forever · perfect to try ClinicSync",
    features: [
      "POS with thermal receipts",
      "Expense tracking",
      "End-of-day reconciliation",
      "Offline-first (PouchDB)",
      "1 cashier seat",
    ],
    whatsMissing: [
      "No extra staff seats",
      "Manual sync only (no auto background)",
      "No low-stock reorder alerts",
      "No multi-branch support",
    ],
  },
  PREMIUM: {
    label: "Premium",
    color: "#f59e0b",
    colorBadge: "bg-amber-100 text-amber-700",
    priceUgx: 25000,
    maxUsers: 3,
    maxProducts: 500,
    maxFacilities: 1,
    autoSync: true,
    tagline: "For a growing shop with staff",
    popular: true,
    features: [
      "Everything in Basic",
      "3 user seats (owner + 2 staff)",
      "Automatic background sync",
      "Reorder & low-stock alerts",
      "FEFO batch expiry tracking",
      "Per-cashier accountability reports",
      "QR / invite-link staff signup",
    ],
    whatsMissing: ["Limited to one branch / clinic", "No advanced owner analytics"],
  },
  PRO: {
    label: "Pro",
    color: "#059669",
    colorBadge: "bg-emerald-100 text-emerald-700",
    priceUgx: 75000,
    maxUsers: 50,
    maxProducts: 5000,
    maxFacilities: 50,
    autoSync: true,
    tagline: "Chain of pharmacies, clinics & drug shops",
    features: [
      "Everything in Premium",
      "50 user seats",
      "Multi-branch / many clinics (up to 50 locations)",
      "Advanced owner analytics dashboard",
      "Weekly & monthly transaction reports",
      "Price & expected-revenue reports",
      "Priority support",
    ],
    whatsMissing: [],
  },
};

// Role labels + colors used to visually distinguish users
export const ROLES = {
  OWNER: { label: "Owner", color: "#059669", badge: "bg-emerald-100 text-emerald-800" },
  PHARMACIST: { label: "Pharmacist", color: "#7c3aed", badge: "bg-violet-100 text-violet-800" },
  CASHIER: { label: "Cashier", color: "#0284c7", badge: "bg-sky-100 text-sky-800" },
};

export const roleMeta = (role) => ROLES[role] || { label: role || "User", color: "#64748b", badge: "bg-slate-100 text-slate-700" };

// Unit options for products (drug shops per tablet/strip/box)
export const UNITS = [
  { key: "Tablet", label: "Per Tablet" },
  { key: "Strip of 10", label: "Strip of 10" },
  { key: "Strip of 6", label: "Strip of 6" },
  { key: "Bottle", label: "Bottle" },
  { key: "Box", label: "Box" },
  { key: "Sachet", label: "Sachet" },
];

export const unitLabel = (u) => (UNITS.find((x) => x.key === u) || { label: u }).label;

// How many tablets one of `unitType` holds. Mirrors the server's helper so the
// POS can show and cap stock in whichever unit the cashier is selling. Returns
// 0 when the unit has no defined tablet relationship (Bottle, Sachet, unknown).
export const tabletsPerUnit = (unitType, product = {}) => {
  const t = String(unitType || "").toLowerCase();
  if (t.startsWith("tablet")) return 1;
  if (t.startsWith("strip")) {
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
};

// How many `unitKey` can be sold from a batch stocked in another unit.
// Stock kept as 100 tablets answers "10 strips" and "1 box" for a 10×10 pack.
// Stock kept AS boxes answers "50 strips": the server opens packs on demand, so
// what matters is the total in the smaller unit, not whole boxes.
export const availableUnits = (batch, unitKey, product = {}) => {
  if (!batch) return 0;
  if (!unitKey || unitKey === batch.unitType) return batch.quantity;
  const wanted = tabletsPerUnit(unitKey, product);
  const have = tabletsPerUnit(batch.unitType, product);
  if (wanted <= 0 || have <= 0) return 0;
  const total = (batch.quantity * have) / wanted;
  // Opening packs only divides cleanly into units that fit the pack; when it
  // does not, no whole number of the smaller unit can be served from a pack.
  const cleaner = have / wanted;
  if (have > wanted && !Number.isInteger(cleaner)) return 0;
  return Math.floor(total);
};

// Catalog price for a given unit key.
export const unitPriceOf = (product = {}, unitKey) => {
  const t = String(unitKey || "").toLowerCase();
  if (t.startsWith("tablet")) return product.tabletPrice;
  if (t.startsWith("strip")) return product.stripPrice;
  if (t.startsWith("box")) return product.boxPrice;
  return null;
};

// A product's sellable units given its price fields
export const productUnits = (p = {}) =>
  [
    { key: "Tablet", price: p.tabletPrice },
    { key: "Strip of 10", price: p.stripPrice },
    { key: "Box", price: p.boxPrice },
  ].filter((u) => u.price != null && u.price > 0);

