import { useEffect, useState } from "react";
import { Lock, CalendarDays, Printer } from "lucide-react";
import { apiFetch } from "../lib/api.js";
import { fmtMoney, fmtDate, todayKey } from "../lib/utils.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function Reconciliation() {
  const { session, setSession } = useAuth();
  const [date, setDate] = useState(todayKey());
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadSummary(d) {
    try {
      const data = await apiFetch(`/reconciliation/summary?date=${encodeURIComponent(d)}`);
      setSummary(data);
    } catch {
      setSummary(null);
    }
  }

  async function loadHistory() {
    try {
      const h = await apiFetch("/reconciliation/history");
      setHistory(h);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    loadSummary(date);
    loadHistory();
  }, [date]);

  async function lockShift() {
    setLoading(true);
    setNotice("");
    try {
      const data = await apiFetch(`/reconciliation/lock?date=${encodeURIComponent(date)}`, {
        method: "POST",
      });
      setSummary(data);
      setNotice("Shift locked ✓ Books finalized for this day.");
      setTimeout(() => setNotice(""), 4000);
      loadHistory();
    } catch (err) {
      setNotice(err.message);
      setTimeout(() => setNotice(""), 4000);
    } finally {
      setLoading(false);
    }
  }

  function printSheet() {
    window.print();
  }

  const rows = summary
    ? [
        { label: "Gross revenue (all sales)", value: summary.totalRevenue },
        { label: "  · Cash received", value: summary.totalRevenue - summary.momoBalance },
        { label: "  · Mobile money (MTN)", value: summary.momoMtn },
        { label: "  · Mobile money (Airtel)", value: summary.momoAirtel },
        { label: "Total expenses", value: -summary.totalExpenses },
        { label: "  · Drugs bought (restock)", value: summary.drugsBoughtTotal },
      ]
    : [];
  const expectedCash = summary
    ? summary.totalRevenue - summary.momoBalance - summary.totalExpenses + summary.drugsBoughtTotal
    : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">End-of-day reconciliation</h1>
          <p className="text-sm text-slate-500">One-click balance sheet · lock your shift</p>
        </div>
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
          <CalendarDays size={16} className="text-slate-400" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="text-sm bg-transparent focus:outline-none"
          />
        </div>
      </div>

      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-2.5 rounded-lg">{notice}</div>
      )}

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <div className="bg-white rounded-xl border border-slate-200 p-6 print-area">
          <div className="text-center border-b border-dashed border-slate-300 pb-3 mb-4">
            <div className="text-lg font-bold text-slate-900">{session?.facility?.name}</div>
            <div className="text-xs text-slate-500">Daily balance sheet · {fmtDate(date)}</div>
            <div className="text-xs text-slate-400 mt-0.5">ClinicSync · Offline-first</div>
          </div>

          {summary ? (
            <>
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className={r.label.startsWith("  ·") ? "pl-4 text-slate-500" : "text-slate-700 font-medium"}>
                      {r.label}
                    </span>
                    <span className="font-mono text-slate-700">{fmtMoney(r.value)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-3 border-t-2 border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900">Expected cash at hand</span>
                  <span className="text-xl font-bold text-emerald-600">{fmtMoney(expectedCash)}</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1 text-right">
                  cash − expenses + drugs bought
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-slate-600">Transactions</span>
                  <span className="font-mono text-slate-700">{summary.salesCount}</span>
                </div>
              </div>

              <div className="mt-4 flex gap-2 no-print">
                <button
                  onClick={lockShift}
                  disabled={loading || summary.isClosed}
                  className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg"
                >
                  <Lock size={15} /> {summary.isClosed ? "Shift locked" : "Lock shift"}
                </button>
                <button
                  onClick={printSheet}
                  className="flex items-center justify-center gap-2 border border-slate-300 text-slate-700 font-medium px-4 py-2.5 rounded-lg"
                >
                  <Printer size={15} /> Print
                </button>
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-400 py-10 text-center">Loading summary…</div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900 mb-3">Past reconciliations</h2>
          {history.length ? (
            <ul className="divide-y divide-slate-100">
              {history.map((h) => (
                <li key={h.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-800">{fmtDate(h.date)}</div>
                    <div className="text-[11px] text-slate-400">
                      {h.salesCount || "—"} transactions · {h.totalExpenses ? "exp " + fmtMoney(h.totalExpenses) : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-emerald-600">{fmtMoney(h.expectedCash)}</div>
                    {h.isClosed ? (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Locked</span>
                    ) : (
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Open</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-slate-400 py-8 text-center">No locked days yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}