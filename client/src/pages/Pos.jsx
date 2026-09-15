import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Trash2, Plus, Minus, Printer, CheckCircle2, Zap, Banknote, Smartphone } from "lucide-react";
import { apiFetch } from "../lib/api.js";
import { salesDb, inventoryDb } from "../lib/db.js";
import { runSync } from "../lib/sync.js";
import { saveDoc } from "../lib/db.js";
import { fmtMoney, fmtShortMoney, fmtDate, fmtTime, unitLabel, productUnits } from "../lib/utils.js";
import { useAuth } from "../context/AuthContext.jsx";

const QUICK_ADDS = ["Paracetamol 500mg", "Amoxicillin 250mg", "Metronidazole 400mg"];

export default function Pos() {
  const { session } = useAuth();
  const [inventory, setInventory] = useState([]);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [query, setQuery] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [momoNetwork, setMomoNetwork] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [printMode, setPrintMode] = useState("thermal");
  const printRef = useRef(null);

  async function loadInventory() {
    try {
      const [cloud, prods] = await Promise.all([apiFetch("/inventory"), apiFetch("/products")]);
      setInventory(cloud);
      setProducts(prods);
    } catch {
      // offline: fall back to local pouchdb inventory
      const res = await inventoryDb.allDocs({ include_docs: true });
      setInventory(res.rows.map((r) => r.doc));
    }
  }

  useEffect(() => {
    loadInventory();
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inventory.slice(0, 30);
    return inventory
      .filter(
        (i) =>
          i.drugName?.toLowerCase().includes(q) ||
          i.unitType?.toLowerCase().includes(q) ||
          (i.productId &&
            products.find((p) => p.id === i.productId)?.name?.toLowerCase().includes(q))
      )
      .slice(0, 30);
  }, [inventory, products, query]);

  const quickAdds = useMemo(
    () => inventory.filter((i) => QUICK_ADDS.includes(i.drugName)).slice(0, 3),
    [inventory]
  );

  // Build a list of sellable SKUs for a given product:
  // - if the product has no linked inventory batches, fall back to per-unit catalog prices
  // - each SKU points at a specific inventory batch (for stock decrement)
  // Cost per unit is scaled from the batch cost to the actual unit (mirrors server logic).
  function skuCost(batch, unitKey) {
    const base = batch?.costPrice || 0;
    const prod = products.find((p) => p.id === batch?.productId);
    if (!prod) return base;
    const sp = prod.stripPrice || 0;
    const tp = prod.tabletPrice || 0;
    const bp = prod.boxPrice || 0;
    if (unitKey === "Tablet" && sp > 0 && tp > 0) return base * (tp / sp);
    if (unitKey === "Box" && sp > 0 && bp > 0) return base * (bp / sp);
    return base;
  }

  function skusForProduct(batch) {
    const prod = products.find((p) => p.id === batch?.productId);
    const units = productUnits(prod || {});
    // If product has no per-unit prices, just sell the batch itself
    if (units.length === 0) {
      return [{ batch, label: batch?.unitType, price: batch?.sellingPrice, cost: batch?.costPrice || 0, key: batch?.id + "-def", qty: 1 }];
    }
    return units
      .filter((u) => u.price != null && u.price > 0)
      .map((u) => ({
        batch,
        label: unitLabel(u.key),
        price: u.price,
        cost: skuCost(batch, u.key),
        key: batch.id + "-" + u.key,
        qty: 1,
        unitKey: u.key,
      }));
  }

  function addToCart(batch, sku) {
    if (!batch || batch.quantity <= 0) {
      setNotice(`"${batch.drugName}" is out of stock`);
      setTimeout(() => setNotice(""), 2500);
      return;
    }
    const qty = sku.qty || 1;
    setCart((prev) => {
      const existing = prev.find((c) => c.cartKey === sku.key);
      if (existing) {
        if (existing.qty + qty > batch.quantity) {
          setNotice(`Only ${batch.quantity} left of ${batch.drugName} (${sku.label})`);
          setTimeout(() => setNotice(""), 2500);
          return prev;
        }
        return prev.map((c) => (c.cartKey === sku.key ? { ...c, qty: c.qty + qty } : c));
      }
      return [
        ...prev,
        {
          cartKey: sku.key,
          inventoryId: batch.id,
          productId: batch.productId || null,
          drugName: batch.drugName,
          unitLabel: sku.label,
          unitKey: sku.unitKey || batch.unitType,
          price: sku.price,
          costPrice: sku.cost || 0,
          qty,
        },
      ];
    });
  }

  function updateQty(cartKey, delta) {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.cartKey !== cartKey) return c;
          const inv = inventory.find((i) => i.id === c.inventoryId);
          const max = inv ? inv.quantity : 999;
          return { ...c, qty: Math.max(1, Math.min(max, c.qty + delta)) };
        })
        .filter((c) => c.qty > 0)
    );
  }

  function removeFromCart(cartKey) {
    setCart((prev) => prev.filter((c) => c.cartKey !== cartKey));
  }

  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const expectedProfit = cart.reduce((s, c) => s + (c.price - c.costPrice) * c.qty, 0);

  async function checkout() {
    if (cart.length === 0 || !total) return;
    setLoading(true);
    setNotice("");

    const payload = {
      items: cart.map((c) => ({
        inventoryId: c.inventoryId,
        productId: c.productId,
        unitType: c.unitKey,
        quantity: c.qty,
      })),
      cashPaid: paymentMethod === "MOMO" ? 0 : total,
      momoPaid: paymentMethod === "MOMO" ? total : 0,
      paymentMethod,
      momoNetwork: paymentMethod === "MOMO" ? momoNetwork || "MTN" : null,
    };

    try {
      const sale = await apiFetch("/sales", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setReceipt(sale);
      setCart([]);
      setQuery("");
      loadInventory();

      await saveDoc(salesDb, {
        _id: sale.id,
        receiptNumber: sale.receiptNumber,
        totalAmount: sale.totalAmount,
        cashPaid: sale.cashPaid,
        momoPaid: sale.momoPaid,
        paymentMethod: sale.paymentMethod,
        momoNetwork: sale.momoNetwork,
        userId: session?.user?.id,
        cashierName: session?.user?.name,
        items: sale.items,
        createdAt: sale.createdAt,
      });

      runSync().catch(() => {});
    } catch (err) {
      // Offline: create sale locally with a temp id
      const localId = crypto.randomUUID();
      const nextReceipt = (parseInt(localStorage.getItem("clinicsync_last_receipt") || "0", 10) || 0) + 1;
      localStorage.setItem("clinicsync_last_receipt", String(nextReceipt));
      const now = new Date().toISOString();
      const localSale = {
        _id: localId,
        receiptNumber: nextReceipt,
        totalAmount: total,
        cashPaid: paymentMethod === "MOMO" ? 0 : total,
        momoPaid: paymentMethod === "MOMO" ? total : 0,
        paymentMethod,
        momoNetwork: paymentMethod === "MOMO" ? momoNetwork || "MTN" : null,
        items: cart.map((c) => ({
          id: crypto.randomUUID(),
          inventoryId: c.inventoryId,
          productId: c.productId,
          unitType: c.unitKey,
          drugName: c.drugName,
          quantity: c.qty,
          unitPrice: c.price,
          totalPrice: c.price * c.qty,
          costPrice: c.costPrice,
        })),
        createdAt: now,
        synced: false,
        userId: session?.user?.id,
        cashierName: session?.user?.name,
      };
      await saveDoc(salesDb, localSale);

      for (const c of cart) {
        try {
          const inv = await inventoryDb.get(c.inventoryId);
          if (inv) {
            await inventoryDb.put({ ...inv, quantity: inv.quantity - c.qty, synced: false });
          }
        } catch {
          /* ignore */
        }
      }
      loadInventory();
      setReceipt(localSale);
      setCart([]);
      setQuery("");
      setNotice("Offline sale saved — will sync when back online.");
      setTimeout(() => setNotice(""), 4000);
    } finally {
      setLoading(false);
    }
  }

  function printReceipt() {
    if (!receipt) return;
    window.print();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Point of Sale</h1>
          <p className="text-sm text-slate-500">Fast cash receipts · works offline · cashier: <span className="font-semibold text-slate-700">{session?.user?.name}</span></p>
        </div>
        <div className="text-sm bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-600">
          Shift date: <span className="font-semibold text-slate-900">{fmtDate(new Date())}</span>
        </div>
      </div>

      {notice && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 text-sm px-4 py-2.5 rounded-lg">{notice}</div>
      )}

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        {/* Product browser */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search drug name or brand…"
                className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {quickAdds.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-400 font-medium">
                  <Zap size={12} /> Quick add
                </span>
                {quickAdds.map((q) => {
                  const s = skusForProduct(q)[0];
                  return (
                    <button
                      key={q.id}
                      onClick={() => addToCart(q, s)}
                      className="flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-medium px-2.5 py-1.5 rounded-full border border-emerald-200"
                    >
                      + {q.drugName.split(" ")[0]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {matches.length === 0 && (
              <div className="sm:col-span-2 text-center text-sm text-slate-400 py-8 bg-white rounded-xl border border-slate-200">
                No products match “{query}”. Add stock in Inventory first.
              </div>
            )}
            {matches.map((item) => {
              const skus = skusForProduct(item);
              const low = item.quantity <= item.reorderLevel;
              return (
                <div
                  key={item.id}
                  className="bg-white rounded-xl border border-slate-200 p-4 hover:border-emerald-300 hover:shadow-md transition-all"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="font-semibold text-slate-900 text-sm">{item.drugName}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{item.unitType}</div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`text-[11px] mt-0.5 font-medium ${low ? "text-amber-600" : "text-slate-400"}`}
                      >
                        {item.quantity} in stock {low && "— low"}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {skus.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => addToCart(item, s)}
                        disabled={item.quantity <= 0}
                        className="flex items-center gap-1 bg-slate-50 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-40 transition-colors"
                      >
                        <Plus size={11} /> {s.label} · {fmtMoney(s.price)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Cart */}
        <div className="bg-white rounded-xl border border-slate-200 lg:sticky lg:top-24">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Current sale</h2>
            <span className="text-xs text-slate-400">{cart.length} items</span>
          </div>

          <div className="px-4 py-2 max-h-72 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="text-sm text-slate-400 py-8 text-center">Cart is empty.<br />Tap a product to add it.</div>
            ) : (
              cart.map((c) => (
                <div key={c.cartKey} className="flex items-center gap-2 py-2 border-b border-slate-50">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{c.drugName} <span className="text-[10px] font-normal text-slate-400">({c.unitLabel})</span></div>
                    <div className="text-[11px] text-slate-400">
                      {fmtMoney(c.price)} × {c.qty} = <span className="font-mono text-slate-500">{fmtMoney(c.price * c.qty)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateQty(c.cartKey, -1)} className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600">
                      <Minus size={12} />
                    </button>
                    <span className="w-7 text-center text-sm font-mono">{c.qty}</span>
                    <button onClick={() => updateQty(c.cartKey, 1)} className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600">
                      <Plus size={12} />
                    </button>
                    <button onClick={() => removeFromCart(c.cartKey)} className="w-6 h-6 rounded hover:bg-red-50 flex items-center justify-center text-slate-400 hover:text-red-600">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="px-4 py-3 border-t border-slate-100">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-slate-500">Total</span>
              <span className="text-2xl font-bold text-slate-900">{fmtMoney(total)}</span>
            </div>
            {cart.length > 0 && (
              <div className="flex items-center justify-between mb-2 text-[11px]">
                <span className="text-slate-400">Expected profit (this sale)</span>
                <span className="font-semibold text-emerald-600">{fmtMoney(expectedProfit)}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                onClick={() => setPaymentMethod("CASH")}
                className={`flex items-center justify-center gap-1.5 border rounded-lg py-2 text-sm font-medium transition-colors ${
                  paymentMethod === "CASH" ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"
                }`}
              >
                <Banknote size={15} /> Cash
              </button>
              <button
                onClick={() => setPaymentMethod("MOMO")}
                className={`flex items-center justify-center gap-1.5 border rounded-lg py-2 text-sm font-medium transition-colors ${
                  paymentMethod === "MOMO" ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"
                }`}
              >
                <Smartphone size={15} /> Mobile Money
              </button>
            </div>

            {paymentMethod === "MOMO" && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                {["MTN", "AIRTEL"].map((net) => (
                  <button
                    key={net}
                    onClick={() => setMomoNetwork(net)}
                    className={`border rounded-lg py-1.5 text-sm font-medium ${
                      momoNetwork === net ? "border-amber-500 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-600"
                    }`}
                  >
                    {net} MoMo
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={checkout}
              disabled={cart.length === 0 || loading}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {loading ? (
                "Processing…"
              ) : (
                <>
                  <CheckCircle2 size={18} /> Charging {fmtMoney(total)}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Receipt modal */}
      {receipt && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            {/* Receipt format toggle */}
            <div className="flex items-center justify-center gap-1 p-3 no-print border-b border-slate-100">
              <button
                onClick={() => setPrintMode((m) => (m === "thermal" ? "phone" : "thermal"))}
                title="Toggle between 80mm thermal receipt and A4 phone/brand PDF"
                className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium px-3 py-1.5 rounded-full"
              >
                {printMode === "thermal" ? (
                  <>
                    <Printer size={13} /> 80mm thermal
                    <span className="text-slate-400">→</span>
                    <Smartphone size={13} /> Phone PDF
                  </>
                ) : (
                  <>
                    <Smartphone size={13} /> Phone PDF
                    <span className="text-slate-400">→</span>
                    <Printer size={13} /> 80mm thermal
                  </>
                )}
              </button>
            </div>

            {printMode === "thermal" ? (
              <div ref={printRef} className="print-area receipt-mode p-5">
              {/* Brand header */}
              <div className="text-center">
                <div className="text-lg font-bold text-slate-900">{session?.facility?.logoEmoji ? `${session?.facility?.logoEmoji} ` : ""}{session?.facility?.brandName || session?.facility?.name}</div>
                {session?.facility?.tagline && (
                  <div className="text-[11px] text-slate-500">{session?.facility?.tagline}</div>
                )}
                {(session?.facility?.address || session?.facility?.phone) && (
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {[session?.facility?.address, session?.facility?.phone].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              <div className="print-rule" />
              <div className="text-center">
                <div className="print-wordmark text-[11px] font-bold tracking-[0.3em] text-slate-600">Receipt</div>
              </div>
              <div className="text-[11px] text-slate-600 mt-1 space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Receipt no.</span>
                  <span className="font-mono font-semibold text-slate-800">#{receipt.receiptNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Date</span>
                  <span>{fmtDate(receipt.createdAt)} {fmtTime(receipt.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Cashier</span>
                  <span>{receipt.cashierName || session?.user?.name || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Payment</span>
                  <span className="font-semibold">{receipt.paymentMethod}{receipt.momoNetwork ? ` · ${receipt.momoNetwork}` : ""}</span>
                </div>
              </div>
              <div className="print-rule" />

              {/* Items table */}
              <table className="print-table mt-1">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Qty</th>
                    <th className="num">Price</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(receipt.items || []).map((it, i) => (
                    <tr key={i}>
                      <td>
                        <span className="text-slate-900 font-medium">{it.drugName}</span>
                        {it.unitType ? (
                          <div className="text-[9px] text-slate-400 uppercase tracking-wide">{unitLabel(it.unitType)}</div>
                        ) : null}
                      </td>
                      <td className="num text-slate-700">{it.quantity}</td>
                      <td className="num text-slate-700">{fmtShortMoney(it.unitPrice)}</td>
                      <td className="num text-slate-900 font-semibold">{fmtShortMoney(it.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="print-rule" />

              {/* Totals */}
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span className="mono">{fmtShortMoney(receipt.totalAmount)}</span>
                </div>
                {receipt.paymentMethod === "CASH" && receipt.cashPaid > 0 && (
                  <>
                    <div className="flex justify-between text-slate-600">
                      <span>Cash tendered</span>
                      <span className="mono">{fmtShortMoney(receipt.cashPaid)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Change</span>
                      <span className="mono">{fmtShortMoney(receipt.cashPaid - receipt.totalAmount)}</span>
                    </div>
                  </>
                )}
              </div>
              <div className="print-rule-solid" />
              <div className="flex justify-between items-center">
                <span className="text-sm font-bold text-slate-900">TOTAL</span>
                <span className="text-base font-extrabold text-slate-900 mono">{fmtShortMoney(receipt.totalAmount)}</span>
              </div>
              <div className="print-rule" />

              <div className="text-center text-[11px] text-slate-500 mt-2">
                <div>Thank you! Come back soon 🙏</div>
                <div className="text-[9px] text-slate-400 mt-0.5">clinic-sync · offline-first · Uganda</div>
              </div>
            </div>
            ) : (
              /* ===== PHONE / A4 PDF receipt (well-decorated brand sheet) ===== */
              <div ref={printRef} className="print-area phone-receipt p-5">
                {/* Header with brand gradient accent */}
                <div className="phone-receipt-header">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-2xl shrink-0">
                      {session?.facility?.logoEmoji || "🏥"}
                    </div>
                    <div>
                      <div className="text-xl font-extrabold text-white leading-tight">
                        {session?.facility?.brandName || session?.facility?.name}
                      </div>
                      {session?.facility?.tagline && (
                        <div className="text-[11px] text-emerald-100">{session?.facility?.tagline}</div>
                      )}
                    </div>
                  </div>
                  {(session?.facility?.address || session?.facility?.phone) && (
                    <div className="mt-2 text-[11px] text-emerald-50/90">
                      {[session?.facility?.address, session?.facility?.phone].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>

                <div className="text-center mt-4">
                  <span className="inline-block bg-emerald-50 text-emerald-700 text-[10px] font-bold tracking-[0.3em] uppercase px-3 py-1 rounded-full">
                    Official Receipt
                  </span>
                </div>

                {/* Sale metadata */}
                <div className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
                  <div>
                    <div className="text-slate-400 text-[10px] uppercase tracking-wide">Receipt no.</div>
                    <div className="font-mono font-bold text-slate-900 text-base">#{receipt.receiptNumber}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-slate-400 text-[10px] uppercase tracking-wide">Date</div>
                    <div className="font-medium text-slate-700">{fmtDate(receipt.createdAt)}</div>
                    <div className="font-medium text-slate-700">{fmtTime(receipt.createdAt)}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[10px] uppercase tracking-wide">Cashier</div>
                    <div className="font-medium text-slate-700">{receipt.cashierName || session?.user?.name || "—"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-slate-400 text-[10px] uppercase tracking-wide">Payment</div>
                    <div className="font-medium text-slate-700">
                      {receipt.paymentMethod}
                      {receipt.momoNetwork ? ` · ${receipt.momoNetwork}` : ""}
                    </div>
                  </div>
                </div>

                <div className="print-rule mt-4" />

                {/* Items table */}
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-1">Items purchased</div>
                <table className="print-table mt-1">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Qty</th>
                      <th className="num">Unit</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(receipt.items || []).map((it, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td>
                          <span className="text-slate-900 font-semibold">{it.drugName}</span>
                          {it.unitType ? (
                            <div className="text-[9px] text-slate-400 uppercase tracking-wide">{unitLabel(it.unitType)}</div>
                          ) : null}
                        </td>
                        <td className="num text-slate-700">{it.quantity}</td>
                        <td className="num text-slate-700">{fmtShortMoney(it.unitPrice)}</td>
                        <td className="num text-slate-900 font-bold">{fmtShortMoney(it.totalPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="print-rule-solid" />

                {/* Totals box */}
                <div className="bg-slate-50 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-slate-500">Subtotal</span>
                    <span className="text-sm font-semibold text-slate-800">{fmtMoney(receipt.totalAmount)}</span>
                  </div>
                  {receipt.paymentMethod === "CASH" && receipt.cashPaid > 0 && (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-slate-500">Cash tendered</span>
                        <span className="text-sm text-slate-700">{fmtMoney(receipt.cashPaid)}</span>
                      </div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-slate-500">Change</span>
                        <span className="text-sm font-semibold text-emerald-600">{fmtMoney(receipt.cashPaid - receipt.totalAmount)}</span>
                      </div>
                    </>
                  )}
                  <div className="border-t border-slate-200 mt-2 pt-2 flex items-center justify-between">
                    <span className="text-base font-bold text-slate-900">TOTAL PAID</span>
                    <span className="text-xl font-extrabold text-emerald-700">{fmtMoney(receipt.totalAmount)}</span>
                  </div>
                </div>

                {/* Thank-you footer */}
                <div className="mt-6 text-center">
                  <div className="text-sm font-semibold text-slate-800">Thank you for shopping with us! 🙏</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">This serves as your official receipt — please keep it for reference.</div>
                  <div className="mt-4 border-t border-dotted border-slate-300 pt-3 text-[10px] text-slate-400">
                    ClinicSync · offline-first · Uganda · {fmtTime(receipt.createdAt)}
                  </div>
                </div>
              </div>
            )}
            <div className="flex gap-2 p-4 no-print">
              <button
                onClick={() => setReceipt(null)}
                className="flex-1 border border-slate-300 text-slate-700 font-medium py-2.5 rounded-lg"
              >
                Done
              </button>
              <button
                onClick={printReceipt}
                className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 rounded-lg"
              >
                <Printer size={16} /> Print {printMode === "thermal" ? "receipt" : "PDF"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}