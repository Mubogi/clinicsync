import dotenv from "dotenv";
import crypto from "node:crypto";

dotenv.config();

export const PORT = process.env.PORT || 5000;

const WEAK_SECRETS = new Set([
  "change-me-to-a-long-random-string",
  "clinicsync-dev-secret-change-me",
  "secret",
  "changeme",
]);

function resolveJwtSecret() {
  const fromEnv = (process.env.JWT_SECRET || "").trim();
  if (fromEnv.length >= 32 && !WEAK_SECRETS.has(fromEnv)) return fromEnv;

  // Refusing to boot in production prevents shipping a guessable signing key,
  // which would let anyone forge an owner token for any facility.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET must be set to a strong random value (>= 32 chars) in production. " +
        "Generate one with: openssl rand -hex 32"
    );
  }

  if (fromEnv) {
    console.warn(
      "[config] JWT_SECRET is weak or a known placeholder — generating a random " +
        "development secret. All sessions are invalidated on restart."
    );
  }
  return crypto.randomBytes(32).toString("hex");
}

export const JWT_SECRET = resolveJwtSecret();
export const NODE_ENV = process.env.NODE_ENV || "development";
export const IS_PROD = NODE_ENV === "production";

export const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Optional dedicated system-admin accounts. Comma-separated emails/user ids.
// When empty, NO user gets platform-admin powers (fail closed) instead of
// granting every facility owner control over every other pharmacy.
export const SYS_ADMIN_IDS = (process.env.SYS_ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const BACKUP_RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 400);