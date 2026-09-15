// Subscription tier catalogue — single source of truth for feature gating & limits.
// Mirrors client/src/lib/utils.js TIERS so the client can show the same copy.

export const TIERS = {
  BASIC: {
    key: "BASIC",
    label: "Basic",
    color: "#64748b",
    colorBadge: "bg-slate-100 text-slate-700",
    priceUgx: 0, // free to start
    maxUsers: 1, // owner + 0 extra cashiers
    maxProducts: 50,
    maxFacilities: 1, // one shop/clinic
    autoSync: false, // manual sync only
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
    key: "PREMIUM",
    label: "Premium",
    color: "#f59e0b",
    colorBadge: "bg-amber-100 text-amber-700",
    priceUgx: 25000, // per month
    maxUsers: 3, // owner + 2 staff
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
    whatsMissing: [
      "Limited to one branch / clinic",
      "No advanced owner analytics",
    ],
  },
  PRO: {
    key: "PRO",
    label: "Pro",
    color: "#059669",
    colorBadge: "bg-emerald-100 text-emerald-700",
    priceUgx: 75000, // per month
    maxUsers: 50,
    maxProducts: 5000,
    maxFacilities: 50, // multi-branch owner portal
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

export function getTier(key) {
  return TIERS[key] || TIERS.BASIC;
}

// Check if a facility can add another user under its current plan.
export function userSlotsUsed(userCount) {
  // userCount = total users including owner
  return userCount;
}