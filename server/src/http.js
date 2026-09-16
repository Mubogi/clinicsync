// Centralised HTTP error responses.
//
// Raw `err.message` must never reach the client: Prisma and driver messages
// leak table names, column names, connection strings and query shapes, which is
// a free reconnaissance channel. Log the detail server-side and return a
// generic message instead.

export function serverError(res, err) {
  console.error("[clinicsync] request failed:", err);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}

// For validation failures we control the message, so it is safe to pass through.
export function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

// Pass through only the messages this codebase authored. Restore/parse paths
// raise useful, user-facing errors, but a Prisma or driver failure in the same
// try/catch would otherwise leak table names and query shapes.
export function safeBadRequest(res, err) {
  const msg = String(err?.message || "");
  const known = [
    "Facility not found",
    "Backup file is corrupt",
    "Backup file is not valid JSON",
    "Backup file is missing required",
    "Backup file was created by a newer",
    "Backup contains no active OWNER",
  ];
  if (known.some((prefix) => msg.startsWith(prefix))) {
    return res.status(400).json({ error: msg });
  }
  console.error("[clinicsync] restore failed:", err);
  return res.status(400).json({ error: "That backup could not be restored." });
}

// Coerce to a positive integer, or return null when the input is unusable.
// `Number.isInteger` rejects NaN, Infinity and fractions, which would otherwise
// slip past `<= 0` checks and corrupt stock levels.
export function toPositiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// Coerce to a non-negative finite number, or null.
export function toNonNegativeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// Cap string length to keep oversized payloads out of the database.
export function cleanString(value, max = 200) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}