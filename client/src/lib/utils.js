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
  BASIC: { label: "Basic", color: "#64748b" },
  PREMIUM: { label: "Premium", color: "#f59e0b" },
  PRO: { label: "Pro", color: "#059669" },
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

// A product's sellable units given its price fields
export const productUnits = (p = {}) =>
  [
    { key: "Tablet", price: p.tabletPrice },
    { key: "Strip of 10", price: p.stripPrice },
    { key: "Box", price: p.boxPrice },
  ].filter((u) => u.price != null && u.price > 0);

