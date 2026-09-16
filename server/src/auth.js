import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { JWT_SECRET } from "./config.js";
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
      select: { id: true, active: true, role: true, facilityId: true, name: true },
    })
    .then((user) => {
      if (!user || !user.active) {
        return res.status(401).json({ error: "Account is no longer active" });
      }
      if (user.facilityId !== payload.facilityId) {
        return res.status(401).json({ error: "Session is no longer valid" });
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

// Helper to serialize a facility for client
export function serializeFacility(f) {
  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    brandName: f.brandName || f.name,
    tagline: f.tagline,
    logoEmoji: f.logoEmoji,
    address: f.address,
    phone: f.phone,
    subscriptionTier: f.subscriptionTier,
    onboarded: f.onboarded ?? true,
  };
}