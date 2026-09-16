import { useEffect, useMemo, useState } from "react";
import { Plus, Search, AlertTriangle, X, PackagePlus, Boxes, BookOpen, TrendingUp } from "lucide-react";
import { apiFetch } from "../lib/api.js";
import { inventoryDb, saveDoc } from "../lib/db.js";
import { runSync } from "../lib/sync.js";
import { fmtMoney, fmtDate, cx, productUnits, unitLabel } from "../lib/utils.js";
import { useAuth } from "../context/AuthContext.jsx";
import MedicineLibrary from "../components/MedicineLibrary.jsx";

const TYPES = ["Strip of 10", "Strip of 6", "Bottle", "Box", "Tablet", "Sachet"];

export default function Inventory() {
  const { session, setSession } = useAuth();
  const role = session?.user?.role;
  const tier = session?.facility?.subscriptionTier || "BASIC";
  const canEdit = role === "OWNER" || role === "PHARMACIST";

  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState("");
  const [syncing, setSyncing] = useState(false);
  // Buy-a-box modal
  const [showBuyBox, setShowBuyBox] = useState(false);
  // Library picker
  const [showLibrary, setShowLibrary] = useState(false);

  const [form, setForm] = useState({
    drugName: "",
    unitType: "Strip of 10",
    quantity: "",
    costPrice: "",
    sellingPrice: "",
    expiryDate: "",
    reorderLevel: "10",
    // Pack composition — how a box breaks into strips and tablets.
    stripsPerBox: "",
    tabletsPerStrip: "",
    // Per-unit catalog prices. All three can be set at once so the cashier can
    // sell a tablet, a strip or a box of the same drug.
    tabletPrice: "",
    stripPrice: "",
    boxPrice: "",
  });
  const [products, setProducts] = useState([]);

  // Buy-a-box form
  const [boxForm, setBoxForm] = useState({
    productId: "",
    boxes: "",
    costPerBox: "",
    expiryDates: "", // CSV or one shared expiry
    supplier: "",
  });

  async function load() {
    try {
      const [cloud, prods] = await Promise.all([apiFetch("/inventory"), apiFetch("/products")]);
      setItems(cloud);
      setProducts(prods);
    } catch {
      const res = await inventoryDb.allDocs({ include_docs: true });
      setItems(res.rows.map((r) => r.doc));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSync() {
    setSyncing(true);
    await runSync();
    setSyncing(false);
    load();
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.drugName?.toLowerCase().includes(q) ||
        i.unitType?.toLowerCase().includes(q)
    );
  }, [items, query]);

  const lowCount = items.filter((i) => i.quantity <= i.reorderLevel).length;

  function blankForm() {
    return {
      drugName: "",
      unitType: "Strip of 10",
      quantity: "",
      costPrice: "",
      sellingPrice: "",
      expiryDate: "",
      reorderLevel: "10",
      stripsPerBox: "",
      tabletsPerStrip: "",
      tabletPrice: "",
      stripPrice: "",
      boxPrice: "",
    };
  }

  function openAdd() {
    setEditing(null);
    setForm(blankForm());
    setShowForm(true);
  }

  // Select a medicine from the Uganda library → prefill the add form
  function handleLibrarySelect(m) {
    const prices = m.commonPrices || {};
    const pack = m.pack || {};
    setEditing(null);
    setForm({
      ...blankForm(),
      drugName: m.name,
      unitType: m.defaultUnit || "Strip of 10",
      costPrice: String(prices.costPrice || ""),
      sellingPrice: String(prices.stripPrice || prices.boxPrice || ""),
      // The library knows real pack sizes and street prices, so a shop that
      // picks a medicine can sell tablets, strips and boxes immediately.
      stripsPerBox: pack.stripsPerBox ? String(pack.stripsPerBox) : (m.stripsPerBox ? String(m.stripsPerBox) : ""),
      tabletsPerStrip: pack.tabletsPerStrip ? String(pack.tabletsPerStrip) : (m.tabletsPerStrip ? String(m.tabletsPerStrip) : ""),
      tabletPrice: prices.tabletPrice != null ? String(prices.tabletPrice) : "",
      stripPrice: prices.stripPrice != null ? String(prices.stripPrice) : "",
      boxPrice: prices.boxPrice != null ? String(prices.boxPrice) : "",
    });
    setShowForm(true);
    setShowLibrary(false);
  }

  // The linked catalog product holds per-unit prices and pack composition.
  function productFor(item) {
    return products.find((p) => p.id === item?.productId) || null;
  }

  function openEdit(item) {
    const prod = productFor(item) || {};
    setEditing(item);
    setForm({
      drugName: item.drugName,
      unitType: item.unitType,
      quantity: String(item.quantity),
      costPrice: String(item.costPrice),
      sellingPrice: String(item.sellingPrice),
      expiryDate: item.expiryDate ? item.expiryDate.slice(0, 10) : "",
      reorderLevel: String(item.reorderLevel),
      stripsPerBox: prod.stripsPerBox ? String(prod.stripsPerBox) : "",
      tabletsPerStrip: prod.tabletsPerStrip ? String(prod.tabletsPerStrip) : "",
      tabletPrice: prod.tabletPrice != null ? String(prod.tabletPrice) : "",
      stripPrice: prod.stripPrice != null ? String(prod.stripPrice) : "",
      boxPrice: prod.boxPrice != null ? String(prod.boxPrice) : "",
    });
    setShowForm(true);
  }

  // Buy a box: create product (if needed) then restock box+strips+tablets
  // from one purchase — "I bought a box at X amount, how do I sell strips/tablets?"
  async function submitBuyBox(e) {
    e.preventDefault();
    const { productId, boxes, costPerBox, expiryDates, supplier } = boxForm;
    if (!productId || !boxes || !costPerBox) {
      setNotice("Choose a medicine, boxes bought and cost per box");
      setTimeout(() => setNotice(""), 3000);
      return;
    }
    const sharedExpiry = expiryDates.split(",")[0]?.trim() || null;
    try {
      const res = await apiFetch("/inventory/buy-pack", {
        method: "POST",
        body: JSON.stringify({
          productId,
          boxes: Number(boxes),
          costPerBox: Number(costPerBox),
          expiryDate: sharedExpiry || null,
          supplier: supplier || null,
        }),
      });
      setShowBuyBox(false);
      setBoxForm({ productId: "", boxes: "", costPerBox: "", expiryDates: "", supplier: "" });
      setNotice(
        `Added ${res.boxes} box(es) → ${res.strips} strips + ${res.tablets} tablets. Sell any unit.`
      );
      setTimeout(() => setNotice(""), 5000);
      load();
      runSync().catch(() => {});
    } catch (err) {
      setNotice(err.message);
      setTimeout(() => setNotice(""), 3500);
    }
  }

  // Open buy-a-box prefilled with an existing product
  function openBuyBox(prefilled) {
    setBoxForm({
      productId: prefilled?.productId || prefilled?.id || "",
      boxes: "",
      costPerBox: prefilled?.costPrice || "",
      expiryDates: "",
      supplier: "",
    });
    setShowBuyBox(true);
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.drugName || !form.quantity || !form.sellingPrice) {
      setNotice("Name, quantity and selling price required");
      setTimeout(() => setNotice(""), 2500);
      return;
    }

    const payload = {
      drugName: form.drugName,
      unitType: form.unitType,
      quantity: Number(form.quantity),
      costPrice: Number(form.costPrice || 0),
      sellingPrice: Number(form.sellingPrice),
      expiryDate: form.expiryDate || null,
      reorderLevel: Number(form.reorderLevel || 10),
      // Sent as numbers when filled, omitted when blank so an existing catalog
      // price is never accidentally wiped by an empty field.
      ...(form.stripsPerBox !== "" ? { stripsPerBox: Number(form.stripsPerBox) } : {}),
      ...(form.tabletsPerStrip !== "" ? { tabletsPerStrip: Number(form.tabletsPerStrip) } : {}),
      ...(form.tabletPrice !== "" ? { tabletPrice: Number(form.tabletPrice) } : {}),
      ...(form.stripPrice !== "" ? { stripPrice: Number(form.stripPrice) } : {}),
      ...(form.boxPrice !== "" ? { boxPrice: Number(form.boxPrice) } : {}),
    };

    try {
      let cloudId;
      if (editing) {
        await apiFetch(`/inventory/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        cloudId = editing.id;
      } else {
        const created = await apiFetch("/inventory", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        cloudId = created.id;
      }
      // persist locally for offline access (reuse server id so sync dedupes)
      const local = await saveDoc(inventoryDb, {
        _id: cloudId,
        ...payload,
      });
      void local;
      setShowForm(false);
      load();
      runSync().catch(() => {});
    } catch (err) {
      setNotice(err.message);
      setTimeout(() => setNotice(""), 3500);
    }
  }

  // Restock an existing item by increasing its quantity (with movement log)
  async function restock(item) {
    const addQty = prompt(`Restock "${item.drugName}" — how many ${item.unitType} to add?`, "10");
    if (addQty == null || isNaN(Number(addQty)) || Number(addQty) <= 0) return;
    try {
      await apiFetch(`/inventory/${item.id}/adjust`, {
        method: "POST",
        body: JSON.stringify({ delta: Number(addQty), reason: "RESTOCK" }),
      });
      setNotice(`Restocked ${addQty} × ${item.unitType} of ${item.drugName}.`);
      setTimeout(() => setNotice(""), 3500);
      load();
      runSync().catch(() => {});
    } catch (err) {
      setNotice(err.message);
      setTimeout(() => setNotice(""), 3500);
    }
  }

  async function remove(id) {
    if (!confirm("Delete this item permanently?")) return;
    try {
      await apiFetch(`/inventory/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setNotice(err.message);
      setTimeout(() => setNotice(""), 3000);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventory</h1>
          <p className="text-sm text-slate-500">Stock levels, pricing & FEFO batch expiry</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && (
            <button
              onClick={() => setShowLibrary(true)}
              className="flex items-center gap-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-3 py-2 rounded-lg"
              title="Add from the Uganda drug library"
            >
              <BookOpen size={16} /> Drug library
            </button>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-3 py-2 rounded-lg"
          >
            {syncing ? "Syncing…" : "Sync"}
          </button>
          {canEdit && (
            <>
              <button
                onClick={() => openBuyBox(null)}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-3 py-2 rounded-lg"
                title="Buy boxes of a drug and ClinicSync splits them into strips + tablets"
              >
                <Boxes size={16} /> Buy a box
              </button>
              <button
                onClick={openAdd}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-3 py-2 rounded-lg"
              >
                <Plus size={16} /> Add item
              </button>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm px-4 py-2.5 rounded-lg">{notice}</div>
      )}

      {lowCount > 0 && tier === "BASIC" && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm px-4 py-2.5 rounded-lg flex items-center gap-2">
          <AlertTriangle size={15} /> Reorder alerts are a Premium+ feature. Upgrade to see low-stock flags in the dashboard.
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search inventory…"
            className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="px-4 py-3">Drug</th>
              <th className="px-4 py-3">Unit</th>
              <th className="px-4 py-3 text-right">Quantity</th>
              <th className="px-4 py-3 text-right">Cost</th>
              <th className="px-4 py-3 text-right">Sell</th>
              <th className="px-4 py-3">Expiry</th>
              <th className="px-4 py-3 text-right">Status</th>
              {canEdit && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const low = item.quantity <= item.reorderLevel;
              const expiringSoon = item.expiryDate && new Date(item.expiryDate) < new Date(Date.now() + 60 * 24 * 3600 * 1000);
              return (
                <tr key={item.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {item.drugName}
                    {(() => {
                      const prod = productFor(item);
                      const units = productUnits(prod || {});
                      if (units.length === 0) return null;
                      return (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {units.map((u) => (
                            <span
                              key={u.key}
                              className="text-[10px] font-normal bg-slate-100 text-slate-600 rounded px-1.5 py-0.5"
                            >
                              {unitLabel(u.key)} {fmtMoney(u.price)}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{item.unitType}</td>
                  <td className={cx("px-4 py-3 text-right font-mono", low ? "text-amber-600 font-semibold" : "text-slate-700")}>
                    {item.quantity}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-500">{fmtMoney(item.costPrice)}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{fmtMoney(item.sellingPrice)}</td>
                  <td className="px-4 py-3">
                    {item.expiryDate ? (
                      <span className={cx("text-xs", expiringSoon ? "text-amber-600 font-medium" : "text-slate-500")}>
                        {fmtDate(item.expiryDate)}
                        {expiringSoon ? " ⚠️" : ""}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {low ? (
                      <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-[11px] font-medium px-2 py-0.5 rounded-full">Low</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 text-[11px] font-medium px-2 py-0.5 rounded-full">OK</span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                      <button onClick={() => restock(item)} className="text-indigo-600 hover:text-indigo-700 text-xs font-semibold">
                        Restock
                      </button>
                      <button
                        onClick={() => openBuyBox(item)}
                        className="text-sky-600 hover:text-sky-700 text-xs font-semibold"
                        title="Buy this drug as boxes of strips/tablets"
                      >
                        Buy box
                      </button>
                      <button onClick={() => openEdit(item)} className="text-emerald-600 hover:text-emerald-700 text-xs font-medium">
                        Edit
                      </button>
                      <button onClick={() => remove(item.id)} className="text-red-500 hover:text-red-600 text-xs font-medium">
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 8 : 7} className="px-4 py-10 text-center text-slate-400">
                  No inventory yet. {canEdit ? "Click “Add item” to create your first product." : ""}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-900">{editing ? "Edit item" : "Add inventory item"}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={submit} className="space-y-3">
              <Field label="Drug name">
                <input
                  className="input"
                  value={form.drugName}
                  onChange={(e) => setForm({ ...form, drugName: e.target.value })}
                  placeholder="e.g. Paracetamol 500mg"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Unit type">
                  <select
                    className="input"
                    value={form.unitType}
                    onChange={(e) => setForm({ ...form, unitType: e.target.value })}
                  >
                    {TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Quantity">
                  <input
                    className="input"
                    type="number"
                    min="0"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cost price (UGX)">
                  <input
                    className="input"
                    type="number"
                    min="0"
                    value={form.costPrice}
                    onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                  />
                </Field>
                <Field label={`Selling price per ${form.unitType} (UGX)`}>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    value={form.sellingPrice}
                    onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
                  />
                </Field>
              </div>

              {/* Pack composition: how one box breaks down. Needed to sell a
                  box, a strip and a tablet out of the same purchase. */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  Pack size
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Tablets per strip">
                    <input
                      className="input"
                      type="number"
                      min="1"
                      value={form.tabletsPerStrip}
                      onChange={(e) => setForm({ ...form, tabletsPerStrip: e.target.value })}
                      placeholder="e.g. 10"
                    />
                  </Field>
                  <Field label="Strips per box">
                    <input
                      className="input"
                      type="number"
                      min="1"
                      value={form.stripsPerBox}
                      onChange={(e) => setForm({ ...form, stripsPerBox: e.target.value })}
                      placeholder="e.g. 10"
                    />
                  </Field>
                </div>

                <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide pt-1">
                  Price each way you sell it
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Per tablet">
                    <input
                      className="input"
                      type="number"
                      min="0"
                      value={form.tabletPrice}
                      onChange={(e) => setForm({ ...form, tabletPrice: e.target.value })}
                      placeholder="—"
                    />
                  </Field>
                  <Field label="Per strip">
                    <input
                      className="input"
                      type="number"
                      min="0"
                      value={form.stripPrice}
                      onChange={(e) => setForm({ ...form, stripPrice: e.target.value })}
                      placeholder="—"
                    />
                  </Field>
                  <Field label="Per box">
                    <input
                      className="input"
                      type="number"
                      min="0"
                      value={form.boxPrice}
                      onChange={(e) => setForm({ ...form, boxPrice: e.target.value })}
                      placeholder="—"
                    />
                  </Field>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Fill in any unit you sell. Leave one blank and the cashier won't offer it.
                  With tablets-per-strip and strips-per-box set, stock bought as a box can be
                  sold as strips or tablets.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Expiry date">
                  <input
                    className="input"
                    type="date"
                    value={form.expiryDate}
                    onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                  />
                </Field>
                <Field label="Reorder level">
                  <input
                    className="input"
                    type="number"
                    min="0"
                    value={form.reorderLevel}
                    onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
                  />
                </Field>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 border border-slate-300 text-slate-700 font-medium py-2.5 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 rounded-lg"
                >
                  {editing ? "Save changes" : "Add item"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Buy-a-box modal — buy boxes at a price, ClinicSync splits into strips + tablets */}
      {showBuyBox && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <PackagePlus size={18} className="text-indigo-600" />
                <h2 className="font-bold text-slate-900">Buy a box — split into sellable units</h2>
              </div>
              <button onClick={() => setShowBuyBox(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-slate-500 -mt-2 mb-4">
              Tell us what one box cost and what's inside — ClinicSync auto-breaks it into strips and tablets so you can sell any unit.
            </p>
            <form onSubmit={submitBuyBox} className="space-y-3">
              <Field label="Medicine">
                <div className="flex gap-2">
                  <select
                    className="input flex-1"
                    value={boxForm.productId}
                    onChange={(e) => setBoxForm({ ...boxForm, productId: e.target.value })}
                  >
                    <option value="">— choose medicine —</option>
                    {items.filter((i) => i.productId).map((i) => (
                      <option key={i.productId} value={i.productId}>
                        {i.drugName}
                      </option>
                    ))}
                    {items.filter((i) => !i.productId).map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.drugName} (unlinked)
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setShowBuyBox(false);
                      setShowLibrary(true);
                    }}
                    className="border border-slate-300 hover:bg-slate-50 text-slate-600 text-sm px-3 rounded-lg shrink-0"
                    title="Add a new medicine from the drug library first"
                  >
                    + New
                  </button>
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Boxes bought">
                  <input
                    className="input"
                    type="number"
                    min="1"
                    value={boxForm.boxes}
                    onChange={(e) => setBoxForm({ ...boxForm, boxes: e.target.value })}
                    placeholder="e.g. 5"
                  />
                </Field>
                <Field label="Cost per box (UGX)">
                  <input
                    className="input"
                    type="number"
                    min="0"
                    value={boxForm.costPerBox}
                    onChange={(e) => setBoxForm({ ...boxForm, costPerBox: e.target.value })}
                    placeholder="e.g. 15000"
                  />
                </Field>
              </div>
              <Field label="Supplier (optional)">
                <input
                  className="input"
                  value={boxForm.supplier}
                  onChange={(e) => setBoxForm({ ...boxForm, supplier: e.target.value })}
                  placeholder="e.g. Kira Wholesale"
                />
              </Field>
              <Field label="Expiry date">
                <input
                  className="input"
                  type="date"
                  value={boxForm.expiryDates}
                  onChange={(e) => setBoxForm({ ...boxForm, expiryDates: e.target.value })}
                />
              </Field>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowBuyBox(false)}
                  className="flex-1 border border-slate-300 text-slate-700 font-medium py-2.5 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-lg"
                >
                  Buy boxes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Uganda drug library picker */}
      {showLibrary && (
        <MedicineLibrary
          onSelect={handleLibrarySelect}
          onClose={() => setShowLibrary(false)}
          title="Add from Uganda drug library"
        />
      )}

      <style>{`.input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 0.5rem; font-size: 0.875rem; } .input:focus { outline: none; border-color: #059669; box-shadow: 0 0 0 2px rgba(5,150,105,0.15); }`}</style>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700 mb-1">{label}</span>
      {children}
    </label>
  );
}