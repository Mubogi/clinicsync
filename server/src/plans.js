// Subscription tier catalogue — single source of truth for feature gating & limits.
// Mirrors client/src/lib/utils.js TIERS so the client can show the same copy.

export const TIERS = {
  BASIC: {
    key: "BASIC",
    label: "Basic",
    color: "#64748b",
    priceUgx: 0, // free to start
    maxUsers: 1, // owner + 0 extra cashiers
    maxProducts: 50,
    maxFacilities: 1, // one shop/clinic
    autoSync: false, // manual sync only
    features: ["POS", "Expenses", "End-of-day", "Offline-first", "Receipts"],
  },
  PREMIUM: {
    key: "PREMIUM",
    label: "Premium",
    color: "#f59e0b",
    priceUgx: 25000, // per month
    maxUsers: 3, // owner + 2 staff
    maxProducts: 500,
    maxFacilities: 1,
    autoSync: true,
    features: [
      "Everything in Basic",
      "Auto background sync",
      "Reorder & low-stock alerts",
      "FEFO batch expiry",
      "Per-cashier accountability",
    ],
  },
  PRO: {
    key: "PRO",
    label: "Pro",
    color: "#059669",
    priceUgx: 75000, // per month
    maxUsers: 50,
    maxProducts: 5000,
    maxFacilities: 50, // multi-branch owner portal
    autoSync: true,
    features: [
      "Everything in Premium",
      "Multi-branch / many clinics",
      "Advanced analytics & owner portal",
      "Price & expected-revenue reports",
      "Priority support",
    ],
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