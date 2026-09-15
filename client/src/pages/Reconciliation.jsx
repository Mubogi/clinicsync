import { useEffect, useState } from "react";
import { Lock, CalendarDays, Printer } from "lucide-react";
import { apiFetch } from "../lib/api.js";
import { fmtMoney, fmtShortMoney, fmtDate, todayKey } from "../lib/utils.js";
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
        <div className="bg-white rounded-xl border border-slate-200 p-6 print-area sheet-mode">
          {/* Branded header */}
          <div className="border-b-2 border-slate-900 pb-3 mb-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-xl font-extrabold text-slate-900">{session?.facility?.logoEmoji ? `${session?.facility?.logoEmoji} ` : ""}{session?.facility?.brandName || session?.facility?.name}</div>
                {session?.facility?.tagline && (
                  <div className="text-[11px] text-slate-500">{session?.facility?.tagline}</div>
                )}
              </div>
              <div className="print-wordmark text-right">Daily Balance Sheet</div>
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 mt-2">
              <span>{[session?.facility?.address, session?.facility?.phone].filter(Boolean).join(" · ")}</span>
              <span className="mono">{fmtDate(date)}</span>
            </div>
          </div>

          {summary ? (
            <>
              {/* Revenue section */}
              <div className="avoid-break">
                <div className="text-[10px] font-bold tracking-[0.2em] text-slate-500 uppercase mb-1">Revenue</div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-800">Gross revenue (all sales)</span>
                    <span className="font-mono font-semibold text-slate-900">{fmtMoney(summary.totalRevenue)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="pl-4 text-slate-500">· Cash received</span>
                    <span className="font-mono text-slate-700">{fmtMoney(summary.totalRevenue - summary.momoBalance)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="pl-4 text-slate-500">· Mobile money (MTN)</span>
                    <span className="font-mono text-slate-700">{fmtMoney(summary.momoMtn)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="pl-4 text-slate-500">· Mobile money (Airtel)</span>
                    <span className="font-mono text-slate-700">{fmtMoney(summary.momoAirtel)}</span>
                  </div>
                </div>
              </div>

              {/* Expenses section */}
              <div className="avoid-break mt-4">
                <div className="text-[10px] font-bold tracking-[0.2em] text-slate-500 uppercase mb-1">Expenses</div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-800">Total expenses</span>
                    <span className="font-mono text-slate-700">{fmtMoney(summary.totalExpenses)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="pl-4 text-slate-500">· Drugs bought (restock)</span>
                    <span className="font-mono text-slate-700">{fmtMoney(summary.drugsBoughtTotal)}</span>
                  </div>
                </div>
              </div>

              <div className="print-rule-solid my-4" />

              {/* Summary / Expected cash */}
              <div className="avoid-break">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-bold text-slate-900">Expected cash at hand</span>
                  <span className="text-2xl font-extrabold text-slate-900 mono">{fmtShortMoney(expectedCash)}</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 text-right">
                  cash received − expenses + drugs bought
                </div>
                <div className="flex justify-between text-xs text-slate-600 mt-2 pt-2 border-t border-dotted border-slate-300">
                  <span>Transactions</span>
                  <span className="mono font-semibold">{summary.salesCount}</span>
                  <span>{summary.isClosed ? "· Locked" : "· Open"}</span>
                </div>
              </div>

              {/* Signature lines */}
              <div className="avoid-break mt-8 grid grid-cols-2 gap-8">
                <div>
                  <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-500">
                    Cashier / Attendant signature
                  </div>
                </div>
                <div>
                  <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-500">
                    Owner / Manager signature
                  </div>
                </div>
              </div>

              <div className="mt-6 text-center text-[10px] text-slate-400">
                ClinicSync · offline-first · Uganda
              </div>

              <div className="mt-6 flex gap-2 no-print">
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