import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Trash2, Plus, Minus, Printer, CheckCircle2, Zap, Banknote, Smartphone } from "lucide-react";
import { apiFetch, setToken, setSession } from "../lib/api.js";
import { salesDb, inventoryDb } from "../lib/db.js";
import { runSync } from "../lib/sync.js";
import { saveDoc } from "../lib/db.js";
import { fmtMoney, fmtDate, fmtTime, todayKey } from "../lib/utils.js";
import { useAuth } from "../context/AuthContext.jsx";

const QUICK_ADDS = ["Paracetamol 500mg", "Amoxicillin 250mg", "Metronidazole 400mg"];

export default function Pos() {
  const { session } = useAuth();
  const [inventory, setInventory] = useState([]);
  const [cart, setCart] = useState([]);
  const [query, setQuery] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [momoNetwork, setMomoNetwork] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const printRef = useRef(null);

  async function loadInventory() {
    try {
      const cloud = await apiFetch("/inventory");
      setInventory(cloud);
    } catch {
      // offline: fall back to local pouchdb inventory
      const res = await inventoryDb.allDocs({ include_docs: true });
      setInventory(res.rows.map((r) => r.doc));
    }
  }

  useEffect(() => {
    loadInventory();
  }, []);

  const isTierLocked = (item) => {
    // Reorder/FEFO features are Premium+; POS works on all tiers
    return false;
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inventory.slice(0, 30);
    return inventory
      .filter(
        (i) =>
          i.drugName?.toLowerCase().includes(q) ||
          i.unitType?.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [inventory, query]);

  const quickAdds = useMemo(
    () => inventory.filter((i) => QUICK_ADDS.includes(i.drugName)).slice(0, 3),
    [inventory]
  );

  function addToCart(item, qty = 1) {
    if (item.quantity <= 0) {
      setNotice(`"${item.drugName}" is out of stock`);
      setTimeout(() => setNotice(""), 2500);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((c) => c.inventoryId === item.id);
      if (existing) {
        if (existing.qty + qty > item.quantity) {
          setNotice(`Only ${item.quantity} left for ${item.drugName}`);
          setTimeout(() => setNotice(""), 2500);
          return prev;
        }
        return prev.map((c) =>
          c.inventoryId === item.id ? { ...c, qty: c.qty + qty } : c
        );
      }
      return [
        ...prev,
        { inventoryId: item.id, drugName: item.drugName, unitType: item.unitType, price: item.sellingPrice, qty },
      ];
    });
  }

  function updateQty(inventoryId, delta) {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.inventoryId !== inventoryId) return c;
          const inv = inventory.find((i) => i.id === inventoryId);
          const max = inv ? inv.quantity : 999;
          return { ...c, qty: Math.max(1, Math.min(max, c.qty + delta)) };
        })
        .filter((c) => c.qty > 0)
    );
  }

  function removeFromCart(inventoryId) {
    setCart((prev) => prev.filter((c) => c.inventoryId !== inventoryId));
  }

  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);

  async function checkout() {
    if (cart.length === 0 || !total) return;
    setLoading(true);
    setNotice("");

    const payload = {
      items: cart.map((c) => ({
        inventoryId: c.inventoryId,
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

      // Persist to offline store too
      await saveDoc(salesDb, {
        _id: sale.id,
        receiptNumber: sale.receiptNumber,
        totalAmount: sale.totalAmount,
        cashPaid: sale.cashPaid,
        momoPaid: sale.momoPaid,
        paymentMethod: sale.paymentMethod,
        momoNetwork: sale.momoNetwork,
        items: sale.items,
        createdAt: sale.createdAt,
      });

      // Try background sync
      runSync().catch(() => {});
    } catch (err) {
      // Offline: create sale locally with a temp id, adjust local inventory
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
          drugName: c.drugName,
          quantity: c.qty,
          unitPrice: c.price,
          totalPrice: c.price * c.qty,
        })),
        createdAt: now,
        synced: false,
      };
      await saveDoc(salesDb, localSale);

      // decrement local inventory
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
    const printContent = printRef.current;
    const original = document.body.innerHTML;
    // Use window.print with a focused print-area approach
    window.print();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Point of Sale</h1>
          <p className="text-sm text-slate-500">Fast cash receipts · works offline</p>
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
                {quickAdds.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => addToCart(q)}
                    className="flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-medium px-2.5 py-1.5 rounded-full border border-emerald-200"
                  >
                    + {q.drugName.split(" ")[0]}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {matches.length === 0 && (
              <div className="sm:col-span-2 text-center text-sm text-slate-400 py-8 bg-white rounded-xl border border-slate-200">
                No products match “{query}”. Add stock in Inventory first.
              </div>
            )}
            {matches.map((item) => (
              <button
                key={item.id}
                onClick={() => addToCart(item)}
                disabled={item.quantity <= 0}
                className="text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-emerald-300 hover:shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900 text-sm">{item.drugName}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{item.unitType}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-600 font-bold text-sm">{fmtMoney(item.sellingPrice)}</div>
                    <div
                      className={`text-[11px] mt-0.5 ${
                        item.quantity <= item.reorderLevel
                          ? "text-amber-600 font-medium"
                          : "text-slate-400"
                      }`}
                    >
                      {item.quantity} in stock
                    </div>
                  </div>
                </div>
              </button>
            ))}
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
                <div key={c.inventoryId} className="flex items-center gap-2 py-2 border-b border-slate-50">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{c.drugName}</div>
                    <div className="text-[11px] text-slate-400">
                      {fmtMoney(c.price)} × {c.qty} = <span className="font-mono text-slate-500">{fmtMoney(c.price * c.qty)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateQty(c.inventoryId, -1)} className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600">
                      <Minus size={12} />
                    </button>
                    <span className="w-7 text-center text-sm font-mono">{c.qty}</span>
                    <button onClick={() => updateQty(c.inventoryId, 1)} className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600">
                      <Plus size={12} />
                    </button>
                    <button onClick={() => removeFromCart(c.inventoryId)} className="w-6 h-6 rounded hover:bg-red-50 flex items-center justify-center text-slate-400 hover:text-red-600">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="px-4 py-3 border-t border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-slate-500">Total</span>
              <span className="text-2xl font-bold text-slate-900">{fmtMoney(total)}</span>
            </div>

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
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full">
            <div ref={printRef} className="print-area p-5">
              <div className="text-center border-b border-dashed border-slate-300 pb-3">
                <div className="text-lg font-bold text-slate-900">{session?.facility?.name}</div>
                <div className="text-xs text-slate-500">Jordan Design Hub · Uganda</div>
                <div className="text-xs text-slate-500 mt-1">Receipt #{receipt.receiptNumber}</div>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-600 py-2 border-b border-dashed border-slate-200">
                <span>{fmtDate(receipt.createdAt)} {fmtTime(receipt.createdAt)}</span>
                <span>{receipt.paymentMethod}{receipt.momoNetwork ? ` · ${receipt.momoNetwork}` : ""}</span>
              </div>
              <div className="py-2">
                {(receipt.items || []).map((it, i) => (
                  <div key={i} className="flex items-start justify-between text-sm py-1">
                    <div className="flex-1 pr-2">
                      <div className="text-slate-800">{it.drugName}</div>
                      <div className="text-[11px] text-slate-400">{it.quantity} × {fmtMoney(it.unitPrice)}</div>
                    </div>
                    <div className="font-mono text-slate-700">{fmtMoney(it.totalPrice)}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-dashed border-slate-300 pt-2 text-sm">
                <span className="font-semibold text-slate-900">TOTAL</span>
                <span className="font-bold text-slate-900">{fmtMoney(receipt.totalAmount)}</span>
              </div>
              <div className="text-center text-xs text-slate-400 mt-3">
                Thank you! Come back soon 🙏
              </div>
            </div>
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
                <Printer size={16} /> Print
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}