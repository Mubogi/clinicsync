// Subscription tier catalogue — single source of truth for feature gating & limits.
// Mirrors client/src/lib/utils.js TIERS so the client can show the same copy.
//
// Every tier is paid. BASIC was previously the "free forever" plan AND the
// fallback applied to a lapsed clinic, which meant an expired subscription kept
// working for free. BASIC is now a paid entry plan, and non-payment resolves to
// the separate LAPSED state below instead.

export const TIERS = {
  BASIC: {
    key: "BASIC",
    label: "Basic",
    color: "#64748b",
    colorBadge: "bg-slate-100 text-slate-700",
    priceUgx: 20000, // per month
    maxUsers: 2, // owner + 1 staff seat
    maxProducts: 100,
    maxFacilities: 1, // one shop/clinic
    autoSync: false, // manual sync only
    tagline: "For a single-counter drug shop getting started",
    features: [
      "POS with thermal receipts",
      "Expense tracking",
      "End-of-day reconciliation",
      "Offline-first (PouchDB)",
      "2 user seats (owner + 1 staff)",
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
    priceUgx: 40000, // per month
    maxUsers: 5, // owner + 4 staff
    maxProducts: 800,
    maxFacilities: 1,
    autoSync: true,
    tagline: "For a growing shop with staff",
    popular: true,
    features: [
      "Everything in Basic",
      "5 user seats (owner + 4 staff)",
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

// What a clinic gets when its paid period has lapsed. Deliberately not in TIERS:
// it is not purchasable, so it can never be selected as a plan. It keeps a
// single seat so the owner can still sign in and settle the bill, and marks the
// account read-only — the data stays intact and nothing is deleted, but the
// business cannot keep trading on an unpaid account.
export const LAPSED = {
  key: "LAPSED",
  label: "Lapsed",
  color: "#dc2626",
  colorBadge: "bg-red-100 text-red-700",
  priceUgx: 0,
  maxUsers: 1,
  maxProducts: 0,
  maxFacilities: 1,
  autoSync: false,
  readOnly: true,
  tagline: "Subscription expired — renew to restore full access",
  features: [
    "Sign in and view existing reports",
    "Renew your subscription",
  ],
  whatsMissing: [
    "Recording sales is paused",
    "Adding stock or staff is paused",
    "Automatic sync is paused",
  ],
};

export function getTier(key) {
  return TIERS[key] || TIERS.BASIC;
}

// Grace window after the period end before the plan actually drops to LAPSED.
// Without it a clinic whose renewal payment clears a day late loses staff seats
// and reports mid-shift; with a short grace they keep working while the admin
// confirms the payment.
export const GRACE_DAYS = 3;

// Free trial granted to a self-registered clinic. Billing is manual, so without
// this a new signup would be unusable until an admin happened to verify their
// first payment.
export const TRIAL_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

// The date the current access period ends: the paid period if one is set,
// otherwise the trial. A clinic with neither has been granted uncapped access by
// an admin (legacy rows, and the seeded demo), and is treated as always active.
function accessEndsAt(facility) {
  const ends = facility.subscriptionEndsAt || facility.trialEndsAt;
  return ends ? new Date(ends) : null;
}

function lapsedTier(facility, storedTier, { expired = false, onTrial = false } = {}) {
  return {
    ...LAPSED,
    storedTier,
    expired,
    onTrial,
    suspended: !!facility.suspended,
    active: false,
    readOnly: true,
    lapsedTier: storedTier,
  };
}

// Resolve the tier a facility is *entitled* to right now, applying trial and
// expiry.
//
// The stored `subscriptionTier` is what the admin granted; this reconciles it
// against the paid period, any trial, and the suspended flag. Callers must use
// this rather than reading facility.subscriptionTier directly, otherwise an
// expired subscription keeps its paid features forever.
export function getEffectiveTier(facility) {
  if (!facility) {
    return { ...LAPSED, storedTier: "BASIC", expired: false, suspended: false, active: false, readOnly: true };
  }

  const storedTier = facility.subscriptionTier || "BASIC";
  const onTrial = !facility.subscriptionEndsAt && !!facility.trialEndsAt;

  if (facility.suspended) {
    return lapsedTier(facility, storedTier, { onTrial });
  }

  const endsAt = accessEndsAt(facility);
  // No period recorded at all means an admin granted open access.
  if (!endsAt) {
    return { ...TIERS[storedTier], storedTier, expired: false, onTrial: false, suspended: false, active: true };
  }

  const expired = Date.now() > endsAt.getTime() + GRACE_DAYS * DAY_MS;
  if (expired) return lapsedTier(facility, storedTier, { expired: true, onTrial });

  // Inside the paid/trial window: full entitlements of the stored tier.
  return { ...TIERS[storedTier], storedTier, expired: false, onTrial, suspended: false, active: true };
}

// Remaining days in the current access period (null when access is uncapped).
export function daysRemaining(facility) {
  const endsAt = accessEndsAt(facility);
  if (!endsAt) return null;
  return Math.ceil((endsAt.getTime() - Date.now()) / DAY_MS);
}

// Monthly price for a tier. Used to compute what a clinic owes before it pays,
// so the figure shown is derived from the same catalogue the gates use.
export function tierPrice(tierKey, months = 1) {
  const tier = TIERS[tierKey];
  if (!tier) return 0;
  return tier.priceUgx * Math.max(1, Math.min(24, Number(months) || 1));
}

// Check if a facility can add another user under its current plan.
export function userSlotsUsed(userCount) {
  // userCount = total users including owner
  return userCount;
}
