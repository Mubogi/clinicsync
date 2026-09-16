#!/usr/bin/env node
// End-to-end API smoke test against a running ClinicSync server.
const BASE = process.env.BASE || "http://localhost:5000/api";
let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${extra !== undefined ? " :: " + JSON.stringify(extra) : ""}`); }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

const T = {};

async function main() {
  console.log("\n== health ==");
  let r = await req("GET", "/health");
  ok("health", r.status === 200 && r.data.ok === true, r);

  console.log("\n== public catalogue ==");
  r = await req("GET", "/auth/plans");
  ok("plans catalogue", r.status === 200 && r.data.plans && r.data.plans.BASIC && r.data.plans.PRO, r.status);
  r = await req("GET", "/auth/facilities");
  ok("facility list", r.status === 200 && Array.isArray(r.data) && r.data.length > 0, r.status);
  const facilityName = r.data.find(f => /Mubogi/.test(f.name))?.name || r.data[0].name;

  console.log("\n== auth ==");
  r = await req("POST", "/auth/login", { body: { facilityName, pinCode: "1234" } });
  ok("owner login via PIN", r.status === 200 && !!r.data.token, r);
  T.owner = r.data?.token;
  r = await req("POST", "/auth/login", { body: { facilityName, pinCode: "2345" } });
  ok("cashier login", r.status === 200 && r.data.user.role === "CASHIER", r);
  T.cashier = r.data?.token;
  r = await req("POST", "/auth/login", { body: { facilityName, pinCode: "3456" } });
  T.pharm = r.data?.token;
  ok("pharmacist login", r.status === 200 && r.data.user.role === "PHARMACIST", r);
  r = await req("POST", "/auth/login", { body: { facilityName, pinCode: "9999" } });
  ok("wrong PIN rejected", r.status === 401, r.status);
  r = await req("GET", "/auth/me");
  ok("unauthenticated blocked", r.status === 401, r.status);
  r = await req("GET", "/auth/me", { token: T.owner });
  ok("me", r.status === 200 && r.data.facility.name, r.status);

  console.log("\n== medicine library ==");
  r = await req("GET", "/library/medicines?limit=200");
  ok("library returns meds", r.status === 200, r.status);
  const lib = Array.isArray(r.data) ? r.data : r.data?.medicines || [];
  ok("library non-empty", lib.length >= 50, lib.length);
  ok("library has pack info", lib.some(m => (m.pack?.stripsPerBox || m.stripsPerBox) && (m.pack?.tabletsPerStrip || m.tabletsPerStrip)), lib[0]);
  T.lib = lib;

  console.log("\n== products (multi-unit pricing + restock) ==");
  const uniq = "TestDrug" + Date.now();
  r = await req("POST", "/products", {
    token: T.owner,
    body: {
      name: uniq, genericName: "Paracetamol", costPrice: 12000, boxPrice: 20000,
      stripPrice: 2500, tabletPrice: 300, stripsPerBox: 10, tabletsPerStrip: 10,
      reorderTablets: 50, reorderStrips: 5, reorderBoxes: 2,
    },
  });
  ok("create product with box/strip/tablet prices", r.status === 201 || r.status === 200, r);
  T.productId = r.data?.id;
  r = await req("GET", "/products", { token: T.owner });
  const prods = Array.isArray(r.data) ? r.data : r.data?.products || [];
  const created = prods.find(p => p.id === T.productId);
  ok("product persisted with 3 unit prices", created && created.boxPrice && created.stripPrice && created.tabletPrice, created);

  console.log("\n== inventory restock ==");
  r = await req("POST", "/inventory", {
    token: T.owner,
    body: { productId: T.productId, drugName: uniq, unitType: "Strip of 10", quantity: 10,
            costPrice: 1200, sellingPrice: 2500, reorderLevel: 5 },
  });
  ok("add inventory batch", r.status === 201 || r.status === 200, r);
  const invId = r.data?.id;
  const qtyBefore = r.data?.quantity ?? 10;
  r = await req("POST", `/inventory/${invId}/adjust`, { token: T.owner, body: { delta: 5, reason: "RESTOCK" } });
  ok("restock increments existing batch", (r.status === 200 || r.status === 201) && r.data?.quantity === qtyBefore + 5, r);
  r = await req("GET", "/inventory", { token: T.owner });
  const invs = Array.isArray(r.data) ? r.data : r.data?.inventory || r.data?.items || [];
  const found = invs.find(i => i.id === invId);
  ok("restock persisted", found && found.quantity === qtyBefore + 5, found && found.quantity);

  console.log("\n== stock movements audit ==");
  r = await req("GET", `/inventory/${invId}/movements`, { token: T.owner });
  ok("movement audit trail records restock", r.status === 200 && Array.isArray(r.data) && r.data.length > 0, r.status);

  console.log("\n== sales (per-unit POS) ==");
  r = await req("POST", "/sales", {
    token: T.owner,
    body: {
      items: [{ inventoryId: invId, productId: T.productId, quantity: 2, unitType: "Tablet", unitPrice: 300 }],
      cashPaid: 600, momoPaid: 0, paymentMethod: "CASH",
    },
  });
  ok("sale in tablet units", (r.status === 201 || r.status === 200) && r.data?.totalAmount === 600, r);
  T.saleId = r.data?.id;
  r = await req("POST", "/sales", {
    token: T.owner,
    body: { items: [{ inventoryId: invId, productId: T.productId, quantity: 1, unitType: "Box", unitPrice: 20000 }],
            cashPaid: 20000, momoPaid: 0, paymentMethod: "CASH" },
  });
  ok("sale in box units uses box price", (r.status === 201 || r.status === 200) && r.data?.totalAmount === 20000, r);
  T.saleId2 = r.data?.id;
  r = await req("GET", "/sales", { token: T.owner });
  const sales = Array.isArray(r.data) ? r.data : r.data?.sales || [];
  ok("sale attributed to cashier", sales.some(s => s.cashierName), sales[0]);

  console.log("\n== accountability (who sold what) ==");
  r = await req("GET", "/dashboard", { token: T.owner });
  ok("dashboard returns analytics", r.status === 200, r.status);

  console.log("\n== delete approval workflow ==");
  r = await req("POST", "/approvals/request", { token: T.cashier, body: { kind: "SALE", id: T.saleId2, reason: "duplicate entry" } });
  ok("cashier requests delete with reason", r.status === 201, r);
  const reqId = r.data?.id;
  r = await req("GET", "/approvals/requests", { token: T.owner });
  ok("owner sees pending request", r.status === 200 && r.data.some(x => x.id === reqId), r.status);
  r = await req("POST", `/approvals/requests/${reqId}/reject`, { token: T.owner });
  ok("owner rejects request", r.status === 200 && r.data.status === "REJECTED", r);
  r = await req("GET", "/sales", { token: T.owner });
  const sales2 = Array.isArray(r.data) ? r.data : r.data?.sales || [];
  ok("rejected delete keeps sale", sales2.some(s => s.id === T.saleId2), "sale still present");
  r = await req("POST", "/approvals/request", { token: T.pharm, body: { kind: "SALE", id: T.saleId2, reason: "still duplicate" } });
  const reqId2 = r.data?.id;
  r = await req("POST", `/approvals/requests/${reqId2}/approve`, { token: T.owner });
  ok("owner approves request", r.status === 200 && r.data.status === "APPROVED", r);
  r = await req("GET", "/sales", { token: T.owner });
  const sales3 = Array.isArray(r.data) ? r.data : r.data?.sales || [];
  ok("approved delete removes sale", !sales3.some(s => s.id === T.saleId2), "sale gone");

  console.log("\n== expenses ==");
  r = await req("POST", "/expenses", { token: T.cashier, body: { category: "Transport", amount: 5000, description: "boda" } });
  ok("cashier logs expense", r.status === 201 || r.status === 200, r);
  T.expenseId = r.data?.id;

  console.log("\n== tier limits ==");
  r = await req("GET", "/auth/users", { token: T.owner });
  ok("users list with plan limits", r.status === 200 && r.data.plan && typeof r.data.plan.maxUsers === "number", r.status);
  r = await req("PATCH", "/auth/facility/tier", { token: T.owner, body: { subscriptionTier: "BASIC" } });
  ok("owner can set tier", r.status === 200 && r.data.subscriptionTier === "BASIC", r.status);
  r = await req("PATCH", "/auth/facility/tier", { token: T.cashier, body: { subscriptionTier: "PRO" } });
  ok("non-owner cannot set tier", r.status === 403, r.status);
  r = await req("PATCH", "/auth/facility/tier", { token: T.owner, body: { subscriptionTier: "PRO" } });
  ok("owner restores multi-seat tier", r.status === 200 && r.data.subscriptionTier === "PRO", r.status);

  console.log("\n== invites / QR join ==");
  r = await req("POST", "/team/invites", { token: T.owner, body: { role: "CASHIER" } });
  ok("owner creates invite", r.status === 201 && !!r.data.token, r);
  const inviteToken = r.data?.token;
  r = await req("POST", "/team/invites", { token: T.cashier, body: { role: "OWNER" } });
  ok("non-owner cannot create invite", r.status === 403, r.status);
  r = await req("POST", "/team/join", { body: { invite: inviteToken, name: "Joined Staff " + Date.now(), pinCode: "4821" } });
  ok("public join redeems invite", r.status === 201 && r.data.ok, r);
  r = await req("POST", "/team/join", { body: { invite: inviteToken, name: "Second Use", pinCode: "5739" } });
  ok("single-use invite cannot be reused", r.status === 410 || r.status === 404, r.status);

  console.log("\n== reconciliation ==");
  r = await req("GET", "/reconciliation/today", { token: T.owner });
  ok("today reconciliation", r.status === 200, r.status);
  r = await req("GET", "/reconciliation/report?period=weekly", { token: T.owner });
  ok("weekly report", r.status === 200, r.status);
  r = await req("GET", "/reconciliation/report?period=monthly", { token: T.owner });
  ok("monthly report", r.status === 200, r.status);

  console.log("\n== backup (requested feature) ==");
  r = await req("GET", "/backups/download", { token: T.owner });
  ok("owner can download backup", r.status === 200, r.status);
  r = await req("GET", "/backups/download", { token: T.cashier });
  ok("cashier cannot download backup", r.status === 403 || r.status === 401, r.status);

  console.log("\n== PWA ==");
  const res = await fetch((process.env.ROOT || "http://localhost:5000") + "/manifest.webmanifest");
  ok("manifest served", res.status === 200, res.status);

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  if (failures.length) console.log("Failures:\n" + failures.map(f => " - " + f).join("\n"));
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error("Test harness error:", e); process.exit(2); });