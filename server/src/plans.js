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

// Grace window after subscriptionEndsAt before the plan actually drops to
// BASIC. Without it a clinic whose renewal payment clears a day late loses
// staff seats and reports mid-shift; with a short grace they keep working while
// the admin confirms the payment.
export const GRACE_DAYS = 3;

// Resolve the tier a facility is *entitled* to right now, applying expiry.
//
// The stored `subscriptionTier` is what the admin granted; this reconciles it
// against the paid period and the suspended flag. Callers must use this rather
// than reading facility.subscriptionTier directly, otherwise an expired
// subscription keeps its paid features forever.
export function getEffectiveTier(facility) {
  if (!facility) return { ...TIERS.BASIC, storedTier: "BASIC", expired: false, suspended: false };

  const storedTier = facility.subscriptionTier || "BASIC";

  // BASIC has no paid period, so it is never "expired".
  if (storedTier === "BASIC") {
    return {
      ...TIERS.BASIC,
      storedTier,
      expired: false,
      suspended: !!facility.suspended,
      active: !facility.suspended,
    };
  }

  const endsAt = facility.subscriptionEndsAt ? new Date(facility.subscriptionEndsAt) : null;
  const graceMs = GRACE_DAYS * 24 * 60 * 60 * 1000;
  const expired = !!endsAt && Date.now() > endsAt.getTime() + graceMs;

  if (facility.suspended || expired) {
    // Downgrade what the clinic can *do*, but keep the paid tier stored so a
    // renewal restores it without the admin re-picking the plan.
    return {
      ...TIERS.BASIC,
      storedTier,
      expired,
      suspended: !!facility.suspended,
      active: false,
      lapsedTier: storedTier,
    };
  }

  return { ...TIERS[storedTier], storedTier, expired: false, suspended: false, active: true };
}

// Remaining days in the paid period (null for BASIC / no expiry set).
export function daysRemaining(facility) {
  if (!facility?.subscriptionEndsAt) return null;
  const ms = new Date(facility.subscriptionEndsAt).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

// Check if a facility can add another user under its current plan.
export function userSlotsUsed(userCount) {
  // userCount = total users including owner
  return userCount;
}