import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { JWT_SECRET, SYS_ADMIN_IDS } from "./config.js";
import { getEffectiveTier } from "./plans.js";
import { prisma } from "./db.js";

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, facilityId: user.facilityId, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

const REMEMBER_DAYS = 30;

export function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Create a persistent "remember me" token so the app auto-logins this user later.
export async function createRememberToken(user, facilityId) {
  const raw = randomToken();
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  const expiresAt = new Date(Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000);
  await prisma.rememberToken.create({
    data: { facilityId, userId: user.id, tokenHash, expiresAt },
  });
  return raw;
}

// Verify a remember-me token and log the user in without a PIN.
export async function consumeRememberToken(rawToken) {
  if (!rawToken) return null;
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const token = await prisma.rememberToken.findUnique({ where: { tokenHash } });
  if (!token) return null;
  if (token.expiresAt < new Date()) {
    await prisma.rememberToken.delete({ where: { id: token.id } });
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: token.userId },
    include: { facility: true },
  });
  if (!user || !user.active) {
    await prisma.rememberToken.delete({ where: { id: token.id } });
    return null;
  }
  return { user, facility: user.facility };
}

export async function revokeAllRememberTokens(userId) {
  await prisma.rememberToken.deleteMany({ where: { userId } });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Re-check the account on every request so that deactivating or demoting a
  // user takes effect immediately instead of after their 30-day token expires.
  prisma.user
    .findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        active: true,
        role: true,
        facilityId: true,
        name: true,
        facility: { select: { suspended: true, suspendedReason: true } },
      },
    })
    .then((user) => {
      if (!user || !user.active) {
        return res.status(401).json({ error: "Account is no longer active" });
      }
      if (user.facilityId !== payload.facilityId) {
        return res.status(401).json({ error: "Session is no longer valid" });
      }
      // A suspended clinic keeps its data but loses access immediately.
      // Platform admins are exempt: the operator usually belongs to a clinic
      // of their own, and blocking them would lock them out of the very console
      // needed to lift the suspension.
      if (user.facility?.suspended && !SYS_ADMIN_IDS.includes(user.id)) {
        return res.status(403).json({
          error:
            user.facility.suspendedReason ||
            "This clinic's account is suspended. Please contact ClinicSync support.",
        });
      }
      req.user = {
        sub: user.id,
        facilityId: user.facilityId,
        role: user.role,
        name: user.name,
      };
      next();
    })
    .catch(next);
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(", ")}` });
    }
    next();
  };
}

// Same rule as requireActiveSubscription, but lets read-only requests through.
//
// Reports and stock lists are how an owner sees what they owe and why they
// should renew, so blocking GETs would remove the very pages that prompt
// payment — while POST/PATCH/DELETE are what actually let the shop keep trading.
export function requireActiveSubscriptionForWrites(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  return requireActiveSubscription(req, res, next);
}

// Helper to serialize a facility for client.
//
// `subscriptionTier` reports the tier the client should actually gate on
// (post-expiry), while `storedTier` preserves what was granted — mirroring the
// server-side getEffectiveTier() so the UI never offers a feature the API will
// reject.
export function serializeFacility(f) {
  const effective = getEffectiveTier(f);
  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    brandName: f.brandName || f.name,
    tagline: f.tagline,
    logoEmoji: f.logoEmoji,
    address: f.address,
    phone: f.phone,
    email: f.email || null,
    subscriptionTier: effective.key,
    storedTier: effective.storedTier,
    subscriptionEndsAt: f.subscriptionEndsAt || null,
    trialEndsAt: f.trialEndsAt || null,
    subscriptionExpired: !!effective.expired,
    onTrial: !!effective.onTrial,
    readOnly: !!effective.readOnly,
    suspended: !!f.suspended,
    onboarded: f.onboarded ?? true,
  };
}

// Block writes for a clinic whose subscription has lapsed.
//
// The data is left completely intact and reads stay open, so the owner can sign
// in, see their reports and settle the bill — but the business cannot keep
// trading (and keep collecting value) on an unpaid account. Applied to the
// write-heavy routers rather than every route, since a lapsed clinic reading its
// own data is exactly what makes renewal possible.
export async function requireActiveSubscription(req, res, next) {
  try {
    const facility = await prisma.facility.findUnique({ where: { id: req.user.facilityId } });
    if (!facility) return res.status(404).json({ error: "Clinic not found" });
    const effective = getEffectiveTier(facility);
    if (effective.readOnly) {
      return res.status(402).json({
        error: facility.suspended
          ? "This account is suspended. Please contact ClinicSync support."
          : "Your subscription has expired. Renew your plan to continue.",
        code: "SUBSCRIPTION_REQUIRED",
        effectiveTier: effective.key,
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}