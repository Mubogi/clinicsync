import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

import { PORT, CORS_ORIGINS } from "./config.js";
import { prisma } from "./db.js";
import { requireAuth } from "./auth.js";

import authRoutes from "./routes/auth.js";
import inventoryRoutes from "./routes/inventory.js";
import saleRoutes from "./routes/sales.js";
import expenseRoutes from "./routes/expenses.js";
import reconciliationRoutes from "./routes/reconciliation.js";
import syncRoutes from "./routes/sync.js";
import dashboardRoutes from "./routes/dashboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "clinicsync-server", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/inventory", requireAuth, inventoryRoutes);
app.use("/api/sales", requireAuth, saleRoutes);
app.use("/api/expenses", requireAuth, expenseRoutes);
app.use("/api/reconciliation", requireAuth, reconciliationRoutes);
app.use("/api/sync", requireAuth, syncRoutes);
app.use("/api/dashboard", requireAuth, dashboardRoutes);

// Serve built client in production
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

const server = app.listen(PORT, () => {
  console.log(`ClinicSync server listening on http://localhost:${PORT}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);