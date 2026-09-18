import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

import { PORT, CORS_ORIGINS, IS_PROD } from "./config.js";
import { prisma } from "./db.js";
import { requireAuth, requireActiveSubscriptionForWrites } from "./auth.js";

import authRoutes from "./routes/auth.js";
import inventoryRoutes from "./routes/inventory.js";
import saleRoutes from "./routes/sales.js";
import expenseRoutes from "./routes/expenses.js";
import reconciliationRoutes from "./routes/reconciliation.js";
import syncRoutes from "./routes/sync.js";
import dashboardRoutes from "./routes/dashboard.js";
import productRoutes from "./routes/products.js";
import adminRoutes from "./routes/admin.js";
import teamRoutes, { joinHandler as teamJoinHandler } from "./routes/team.js";
import approvalRoutes from "./routes/approvals.js";
import libraryRoutes from "./routes/library.js";
import backupRoutes from "./routes/backups.js";
import billingRoutes from "./routes/billing.js";
import { runMonthlyBackups } from "./backup.js";
import { serverError } from "./http.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Behind the runtime's reverse proxy; trust one hop so rate limiting keys on
// the real client IP rather than the proxy's.
app.set("trust proxy", 1);

app.use(
  helmet({
    // The SPA is served from this same origin in production. Inline styles are
    // needed by the built bundle; scripts are file-based, so 'self' suffices and
    // blocks injected inline handlers. `blob:` covers print/export flows.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "no-referrer" },
    hsts: IS_PROD ? { maxAge: 15552000, includeSubDomains: true } : false,
  })
);

// Restrict CORS to configured origins and reject everything else. An absent
// Origin header (curl, server-to-server, same-origin) is allowed through.
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || CORS_ORIGINS.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

// Blanket limiter so a single client cannot hammer the API.
app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    max: IS_PROD ? 300 : 2000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down." },
  })
);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "clinicsync-server", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/inventory", requireAuth, requireActiveSubscriptionForWrites, inventoryRoutes);
app.use("/api/products", requireAuth, requireActiveSubscriptionForWrites, productRoutes);
app.use("/api/sales", requireAuth, requireActiveSubscriptionForWrites, saleRoutes);
app.use("/api/expenses", requireAuth, requireActiveSubscriptionForWrites, expenseRoutes);
app.use("/api/reconciliation", requireAuth, requireActiveSubscriptionForWrites, reconciliationRoutes);
app.use("/api/sync", requireAuth, requireActiveSubscriptionForWrites, syncRoutes);
app.use("/api/dashboard", requireAuth, dashboardRoutes);
app.use("/api/admin", requireAuth, adminRoutes);
app.use("/api/backups", requireAuth, backupRoutes);
// The join (invite redemption) endpoint is public — staff use it from a link/QR
// without an account yet. Everything else under /team requires auth.
app.post("/api/team/join", teamJoinHandler);
app.use("/api/team", requireAuth, teamRoutes);
app.use("/api/approvals", requireAuth, approvalRoutes);
app.use("/api/library", libraryRoutes);
// Public pricing/till details (`/config`, `/quote`) plus owner payment claims.
app.use("/api/billing", billingRoutes);

// Serve built client in production
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      setHeaders(res, filePath) {
        // The service worker and the HTML shell must never be cached, otherwise
        // installed PWAs get pinned to an old build and stop updating.
        if (filePath.endsWith("sw.js") || filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  // Dev (or unbuilt) mode: still serve the manifest + service worker so the PWA
  // is installable while testing, even though the SPA itself is on Vite.
  const publicDir = path.join(__dirname, "..", "..", "client", "public");
  app.use(
    express.static(publicDir, {
      etag: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith("sw.js") || filePath.endsWith("manifest.webmanifest")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Service-Worker-Allowed", "/");
        }
      },
    })
  );
}

// Error handler — never echo raw internal messages to the client.
app.use((err, _req, res, _next) => {
  if (res.headersSent) return;
  serverError(res, err);
});

const server = app.listen(PORT, () => {
  console.log(`ClinicSync server listening on http://localhost:${PORT}`);
  scheduleMonthlyBackups();
});

// Monthly backup scheduler. Runs at boot (so a restart catches up a missed
// month) and then every 6 hours, which runs the per-month idempotency check in
// runMonthlyBackups so each clinic gets exactly one MONTHLY backup per month.
function scheduleMonthlyBackups() {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  const tick = () => {
    runMonthlyBackups().catch((err) => console.error("[backup] scheduler error:", err.message));
  };
  setTimeout(tick, 30_000).unref();
  setInterval(tick, SIX_HOURS).unref();
}

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);