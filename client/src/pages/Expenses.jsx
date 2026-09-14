import { useEffect, useState } from "react";
import { Plus, Trash2, Wallet } from "lucide-react";
import { apiFetch } from "../lib/api.js";
import { expensesDb, saveDoc } from "../lib/db.js";
import { runSync } from "../lib/sync.js";
import { fmtMoney, fmtDate, fmtTime } from "../lib/utils.js";
import { useAuth } from "../context/AuthContext.jsx";

const CATEGORIES = [
  "YAKA / Electricity",
  "Water",
  "Staff Allowance",
  "Transport",
  "Packaging",
  "Wholesale Restock (Drugs Bought)",
  "Internet / Data",
  "Rent",
  "Other",
];

export default function Expenses() {
  const { session } = useAuth();
  const [expenses, setExpenses] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ category: "YAKA / Electricity", amount: "", description: "" });

  async function load() {
    try {
      const cloud = await apiFetch("/expenses");
      setExpenses(cloud);
    } catch {
      const res = await expensesDb.allDocs({ include_docs: true });
      setExpenses(res.rows.map((r) => r.doc));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!form.amount) {
      setNotice("Amount required");
      setTimeout(() => setNotice(""), 2500);
      return;
    }
    const payload = {
      category: form.category,
      amount: Number(form.amount),
      description: form.description || null,
    };
    try {
      const created = await apiFetch("/expenses", { method: "POST", body: JSON.stringify(payload) });
      // reuse server id locally so a later sync push dedupes instead of duplicating
      await saveDoc(expensesDb, {
        _id: created.id,
        category: created.category,
        amount: created.amount,
        description: created.description ?? payload.description,
        createdAt: created.createdAt,
      });
      setShowForm(false);
      setForm({ category: "YAKA / Electricity", amount: "", description: "" });
      load();
      runSync().catch(() => {});
    } catch (err) {
      // offline
      await saveDoc(expensesDb, { _id: crypto.randomUUID(), ...payload, createdAt: new Date().toISOString() });
      setShowForm(false);
      setForm({ category: "YAKA / Electricity", amount: "", description: "" });
      setNotice("Saved offline — will sync later.");
      setTimeout(() => setNotice(""), 3000);
      load();
    }
  }

  async function remove(id) {
    try {
      await apiFetch(`/expenses/${id}`, { method: "DELETE" });
      load();
    } catch {
      try {
        const doc = await expensesDb.get(id);
        await expensesDb.remove(doc);
      } catch {}
      load();
    }
  }

  const total = expenses.reduce((s, x) => s + (x.amount || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Daily expenses</h1>
          <p className="text-sm text-slate-500">Track YAKA, transport, allowances & restock spend</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          <Plus size={16} /> Log expense
        </button>
      </div>

      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-2.5 rounded-lg">{notice}</div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-600">
          <Wallet size={18} className="text-emerald-600" />
          <span className="text-sm font-medium">Total today</span>
        </div>
        <span className="text-xl font-bold text-slate-900">{fmtMoney(total)}</span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                <td className="px-4 py-3">
                  <span className="inline-flex bg-slate-100 text-slate-700 text-xs font-medium px-2 py-0.5 rounded-full">
                    {e.category}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{e.description || <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {fmtDate(e.createdAt)} {fmtTime(e.createdAt)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-700 font-medium">{fmtMoney(e.amount)}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => remove(e.id)} className="text-slate-300 hover:text-red-600">
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  No expenses logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="font-bold text-slate-900 mb-4">Log an expense</h2>
            <form onSubmit={submit} className="space-y-3">
              <label className="block">
                <span className="block text-sm font-medium text-slate-700 mb-1">Category</span>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-slate-700 mb-1">Amount (UGX)</span>
                <input
                  type="number"
                  min="0"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  placeholder="0"
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-slate-700 mb-1">Note</span>
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  placeholder="e.g. Yaka units for the week"
                />
              </label>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 border border-slate-300 text-slate-700 font-medium py-2.5 rounded-lg"
                >
                  Cancel
                </button>
                <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 rounded-lg">
                  Save expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}