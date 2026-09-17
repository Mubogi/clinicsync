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
  ok("owner can downgrade to BASIC", r.status === 200 && r.data.subscriptionTier === "BASIC", r.status);
  r = await req("PATCH", "/auth/facility/tier", { token: T.cashier, body: { subscriptionTier: "PRO" } });
  ok("non-owner cannot set tier", r.status === 403, r.status);

  // Paywall: an owner must NOT be able to grant themselves a paid plan.
  r = await req("PATCH", "/auth/facility/tier", { token: T.owner, body: { subscriptionTier: "PRO" } });
  ok("owner cannot self-upgrade to a paid tier", r.status === 403, r.status);

  // The platform admin is the only way to activate a paid plan. The seeded
  // owner is also the configured SYS_ADMIN_IDS entry in tests.
  const facilityId = T.facilityId || (await req("GET", "/auth/me", { token: T.owner })).data?.facility?.id;
  r = await req("POST", `/admin/facilities/${facilityId}/subscription`, {
    token: T.owner,
    body: { tier: "PRO", months: 1, amountUgx: 75000, note: "e2e" },
  });
  ok("admin activates paid tier for a time frame", r.status === 200 && r.data.facility.subscriptionTier === "PRO" && !!r.data.subscriptionEndsAt, r);

  // Renewing early must extend, not replace, the period already paid for.
  const firstEnd = new Date(r.data.subscriptionEndsAt).getTime();
  r = await req("POST", `/admin/facilities/${facilityId}/subscription`, {
    token: T.owner,
    body: { tier: "PRO", months: 1, amountUgx: 75000 },
  });
  const secondEnd = new Date(r.data.subscriptionEndsAt).getTime();
  ok("renewal extends the existing period", secondEnd > firstEnd, { firstEnd, secondEnd });

  r = await req("GET", `/admin/facilities/${facilityId}/payments`, { token: T.owner });
  ok("payment history is recorded", r.status === 200 && r.data.payments.length >= 2, r.status);

  r = await req("GET", "/admin/overview", { token: T.owner });
  ok("admin overview reports MRR", r.status === 200 && typeof r.data.mrrUgx === "number", r.status);

  // A clinic that is not a platform admin must not reach the admin API.
  r = await req("GET", "/admin/facilities", { token: T.cashier });
  ok("non-admin cannot list all clinics", r.status === 403, r.status);

  // Per-user deactivation: takes effect on the user's next request.
  r = await req("GET", `/admin/facilities/${facilityId}/users`, { token: T.owner });
  ok("admin lists a clinic's users", r.status === 200 && Array.isArray(r.data) && r.data.length > 0, r.status);
  const cashierRow = (r.data || []).find((u) => u.role === "CASHIER");
  if (cashierRow) {
    r = await req("PATCH", `/admin/users/${cashierRow.id}/active`, {
      token: T.owner,
      body: { active: false },
    });
    ok("admin deactivates a user", r.status === 200 && r.data.active === false, r);

    const cashierToken = T.cashier;
    r = await req("GET", "/inventory", { token: cashierToken });
    ok("deactivated user is locked out immediately", r.status === 401, r.status);

    r = await req("PATCH", `/admin/users/${cashierRow.id}/active`, {
      token: T.owner,
      body: { active: true },
    });
    ok("admin reactivates a user", r.status === 200 && r.data.active === true, r);
    r = await req("GET", "/inventory", { token: cashierToken });
    ok("reactivated user regains access", r.status === 200, r.status);
  }

  // The operator must not be able to lock themselves out.
  const adminMe = (await req("GET", "/auth/me", { token: T.owner })).data;
  r = await req("PATCH", `/admin/users/${adminMe?.user?.id}/active`, {
    token: T.owner,
    body: { active: false },
  });
  ok("admin cannot deactivate their own account", r.status === 400, r.status);

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

  console.log("\n== product unit pricing (sell by tablet / strip / box) ==");
  // Regression: a shop that prices a drug as a strip must be able to sell a
  // strip. Previously the product ended up with only the price of the unit the
  // batch was created in, so nothing else could be sold.
  const uName = "UnitTest" + Date.now();
  r = await req("POST", "/inventory", {
    token: T.owner,
    body: { drugName: uName + "StripOnly", unitType: "Strip of 10", quantity: 20, costPrice: 500, sellingPrice: 1200 },
  });
  ok("add item priced only as a strip", r.status === 201 || r.status === 200, r);
  r = await req("GET", "/products", { token: T.owner });
  let ps = Array.isArray(r.data) ? r.data : r.data?.products || [];
  const p1 = ps.find(p => p.name === uName + "StripOnly");
  ok("strip-only drug is sellable as a strip", p1 && p1.stripPrice === 1200, p1);

  // All three unit prices, set in one go.
  const uAll = uName + "All";
  r = await req("POST", "/inventory", {
    token: T.owner,
    body: {
      drugName: uAll, unitType: "Box", quantity: 5, costPrice: 12000, sellingPrice: 20000,
      stripsPerBox: 10, tabletsPerStrip: 10, tabletPrice: 300, stripPrice: 2500, boxPrice: 20000,
    },
  });
  ok("add item with all three unit prices", r.status === 201 || r.status === 200, r);
  r = await req("GET", "/products", { token: T.owner });
  ps = Array.isArray(r.data) ? r.data : r.data?.products || [];
  const p2 = ps.find(p => p.name === uAll);
  ok("tablet+strip+box prices persisted", p2 && p2.tabletPrice === 300 && p2.stripPrice === 2500 && p2.boxPrice === 20000, p2);
  ok("pack size persisted (10 strips/box, 10 tablets/strip)", p2 && p2.stripsPerBox === 10 && p2.tabletsPerStrip === 10, p2);

  r = await req("GET", "/inventory", { token: T.owner });
  let ivs = Array.isArray(r.data) ? r.data : r.data?.inventory || [];
  const boxBatch = ivs.find(i => i.drugName === uAll && i.unitType === "Box");
  ok("box batch has 5 boxes (500 tablets)", !!boxBatch && boxBatch.quantity === 5, boxBatch && boxBatch.quantity);

  // Sell 2 strips out of stock held as boxes: one box must be opened.
  const tabletsIn = (u) => (u === "Box" ? 100 : u.startsWith("Strip") ? parseInt(u.replace(/\D/g, ""), 10) || 10 : 1);
  const tabletsOf = async (name) => {
    const rr = await req("GET", "/inventory", { token: T.owner });
    const list = Array.isArray(rr.data) ? rr.data : rr.data?.inventory || [];
    return list.filter(i => i.drugName === name).reduce((s, i) => s + i.quantity * tabletsIn(i.unitType), 0);
  };

  r = await req("POST", "/sales", {
    token: T.owner,
    body: { items: [{ inventoryId: boxBatch.id, productId: p2.id, unitType: "Strip of 10", quantity: 2 }], cashPaid: 5000, paymentMethod: "CASH" },
  });
  ok("sell strips from box-held stock", (r.status === 201 || r.status === 200) && r.data?.totalAmount === 5000, r);
  let tabs = await tabletsOf(uAll);
  ok("opening a box preserves stock (500 - 2 strips = 480 tablets)", tabs === 480, tabs);

  // Sell 25 tablets out of the same box-held stock: 3 strips get opened.
  r = await req("POST", "/sales", {
    token: T.owner,
    body: { items: [{ inventoryId: boxBatch.id, productId: p2.id, unitType: "Tablet", quantity: 25 }], cashPaid: 7500, paymentMethod: "CASH" },
  });
  ok("sell tablets from box-held stock", (r.status === 201 || r.status === 200) && r.data?.totalAmount === 7500, r);
  tabs = await tabletsOf(uAll);
  ok("opening strips preserves stock (480 - 25 = 455 tablets)", tabs === 455, tabs);

  // Overselling must be refused rather than silently emptying the batch.
  r = await req("POST", "/sales", {
    token: T.owner,
    body: { items: [{ inventoryId: boxBatch.id, productId: p2.id, unitType: "Box", quantity: 99 }], cashPaid: 1, paymentMethod: "CASH" },
  });
  ok("overselling a box is refused", r.status === 409, r.status);

  // Editing an item's unit prices must reach the product the POS sells from.
  r = await req("POST", "/inventory", {
    token: T.owner,
    body: { drugName: uName + "Edit", unitType: "Strip of 10", quantity: 10, costPrice: 500, sellingPrice: 1200 },
  });
  const editId = r.data?.id;
  r = await req("PATCH", `/inventory/${editId}`, {
    token: T.owner,
    body: { tabletPrice: 200, boxPrice: 15000, stripsPerBox: 10, tabletsPerStrip: 10 },
  });
  ok("edit inventory item saves per-unit prices", r.status === 200, r);
  r = await req("GET", "/products", { token: T.owner });
  ps = Array.isArray(r.data) ? r.data : r.data?.products || [];
  const p3 = ps.find(p => p.name === uName + "Edit");
  ok("edited unit prices visible to POS", p3 && p3.tabletPrice === 200 && p3.boxPrice === 15000 && p3.stripPrice === 1200, p3);

  // A cashier may sell but not reprice.
  r = await req("PATCH", `/inventory/${editId}`, { token: T.cashier, body: { boxPrice: 1 } });
  ok("cashier cannot reprice an item", r.status === 401 || r.status === 403, r.status);

  console.log("\n== security: account lockout & audit ==");
  // A clinic is locked after repeated wrong PINs, even from rotating IPs.
  r = await req("POST", "/admin/facilities", {
    token: T.owner,
    body: { name: "LockTest" + Date.now(), ownerName: "Lock Owner", ownerPin: "4321" },
  });
  const lockName = r.data?.facility?.name;
  const lockId = r.data?.facility?.id;
  if (lockName) {
    for (let i = 0; i < 5; i++) {
      await req("POST", "/auth/login", { body: { facilityName: lockName, pinCode: "0000" } });
    }
    r = await req("POST", "/auth/login", { body: { facilityName: lockName, pinCode: "0000" } });
    ok("clinic locks after repeated wrong PINs", r.status === 429, r.status);
    r = await req("POST", "/auth/login", { body: { facilityName: lockName, pinCode: "4321" } });
    ok("lockout refuses even the correct PIN", r.status === 429, r.status);
    // Remove the throwaway clinic so it cannot accumulate between runs.
    r = await req("DELETE", `/admin/facilities/${lockId}`, { token: T.owner });
    ok("admin can delete a clinic it created", r.status === 200, r.status);
  } else {
    ok("clinic locks after repeated wrong PINs", false, "could not create lockout clinic");
  }

  // The platform-admin surface stays closed to ordinary staff. (The seeded
  // owner is the configured sysadmin, so the cashier is the right probe here.)
  r = await req("GET", "/admin/audit", { token: T.cashier });
  ok("non-admin cannot read admin audit log", r.status === 401 || r.status === 403, r.status);
  r = await req("POST", "/admin/facilities", { token: T.cashier, body: { name: "Nope", ownerName: "x", ownerPin: "1111" } });
  ok("non-admin cannot create clinics", r.status === 401 || r.status === 403, r.status);

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

  console.log("\n== offline sync decrements stock ==");
  // A sale rung up offline is pushed as a whole record, separate from the live
  // /sales path. It used to be written to the ledger without touching stock, so
  // every offline sale leaked inventory.
  r = await req("POST", "/inventory", {
    token: T.owner,
    body: {
      drugName: uName + "Offline", unitType: "Strip of 10", quantity: 40,
      costPrice: 500, sellingPrice: 1200, tabletPrice: 200, stripsPerBox: 10, tabletsPerStrip: 10,
    },
  });
  const offId = r.data?.id;
  ok("offline test batch created", r.status === 201 || r.status === 200, r);
  r = await req("GET", "/products", { token: T.owner });
  ps = Array.isArray(r.data) ? r.data : r.data?.products || [];
  const pOff = ps.find(p => p.name === uName + "Offline");

  const offSale = (id, unit, qty, price) => ({
    id, receiptNumber: 90000 + qty, totalAmount: price * qty, cashPaid: price * qty,
    momoPaid: 0, paymentMethod: "CASH", createdAt: new Date().toISOString(),
    items: [{
      inventoryId: offId, productId: pOff.id, drugName: uName + "Offline",
      unitType: unit, quantity: qty, unitPrice: price, totalPrice: price * qty, costPrice: 500,
    }],
  });

  const offQty = async () => {
    const rr = await req("GET", "/inventory", { token: T.owner });
    const list = Array.isArray(rr.data) ? rr.data : rr.data?.inventory || [];
    return list.filter(i => i.drugName === uName + "Offline" && i.unitType === "Strip of 10")
      .reduce((s, i) => s + i.quantity, 0);
  };

  const before = await offQty();
  r = await req("POST", "/sync/push", { token: T.owner, body: { sales: [offSale("e2e-off-1-" + uName, "Strip of 10", 7, 1200)] } });
  ok("offline sale accepted", r.status === 200 && r.data?.pushed?.sales === 1, r);
  const after = await offQty();
  ok("offline sale decrements stock (40 - 7 = 33)", after === before - 7, `${before} -> ${after}`);

  // A retried push (client lost the ack) must not subtract the same sale twice.
  r = await req("POST", "/sync/push", { token: T.owner, body: { sales: [offSale("e2e-off-1-" + uName, "Strip of 10", 7, 1200)] } });
  const replayed = await offQty();
  ok("replaying an offline sale does not double-decrement", replayed === after, `${after} -> ${replayed}`);

  // Selling tablets offline out of strip-held stock must open a pack, exactly
  // as the live /sales path does.
  const tabletsOff = async () => {
    const rr = await req("GET", "/inventory", { token: T.owner });
    const list = Array.isArray(rr.data) ? rr.data : rr.data?.inventory || [];
    return list.filter(i => i.drugName === uName + "Offline")
      .reduce((s, i) => s + i.quantity * (i.unitType.startsWith("Strip") ? 10 : 1), 0);
  };
  const tabsBefore = await tabletsOff();
  r = await req("POST", "/sync/push", { token: T.owner, body: { sales: [offSale("e2e-off-2-" + uName, "Tablet", 3, 200)] } });
  ok("offline tablet sale accepted", r.status === 200, r);
  const tabsAfter = await tabletsOff();
  ok("offline sale opens a pack (330 - 3 = 327 tablets)", tabsAfter === tabsBefore - 3, `${tabsBefore} -> ${tabsAfter}`);
  r = await req("GET", "/inventory", { token: T.owner });
  ivs = Array.isArray(r.data) ? r.data : r.data?.inventory || [];
  const openedBatch = ivs.find(i => i.drugName === uName + "Offline" && i.unitType === "Tablet");
  ok("opened tablets exist as their own batch", !!openedBatch && openedBatch.quantity === 7, openedBatch && openedBatch.quantity);

  console.log("\n== PWA ==");
  const res = await fetch((process.env.ROOT || "http://localhost:5000") + "/manifest.webmanifest");
  ok("manifest served", res.status === 200, res.status);

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  if (failures.length) console.log("Failures:\n" + failures.map(f => " - " + f).join("\n"));
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error("Test harness error:", e); process.exit(2); });