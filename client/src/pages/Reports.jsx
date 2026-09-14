import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Users, Building2, Smartphone } from "lucide-react";
import { apiFetch } from "../lib/api.js";
import { fmtMoney, fmtDate, TIERS } from "../lib/utils.js";
import { useAuth } from "../context/AuthContext.jsx";

function MiniBarChart({ data }) {
  const days = Object.keys(data);
  if (days.length === 0) return <div className="text-xs text-slate-400 py-4 text-center">No data in range.</div>;
  const values = Object.values(data);
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-1 h-28 mt-4">
      {days.map((d) => (
        <div key={d} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-emerald-500 rounded-t"
            style={{ height: `${Math.max(4, (data[d] / max) * 96)}px` }}
            title={`${d}: ${fmtMoney(data[d])}`}
          />
          <span className="text-[9px] text-slate-400 -rotate-45 origin-top-left whitespace-nowrap">{d.slice(8)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Reports() {
  const { session, setSession } = useAuth();
  const [range, setRange] = useState(30);
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);

  const isOwner = session?.user?.role === "OWNER";

  async function load() {
    try {
      const [d, u] = await Promise.all([apiFetch(`/dashboard?days=${range}`), apiFetch("/auth/users")]);
      setData(d);
      setUsers(u);
    } catch {
      /* offline */
    }
  }

  useEffect(() => {
    load();
  }, [range]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Owner reports</h1>
          <p className="text-sm text-slate-500">Performance across the last {range} days</p>
        </div>
        <select
          value={range}
          onChange={(e) => setRange(Number(e.target.value))}
          className="bg-white border border-slate-300 text-sm px-3 py-2 rounded-lg"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <BigStat icon={<TrendingUp size={18} />} label="Gross revenue" value={fmtMoney(data.totalRevenue)} sub={`${data.totalSales} sales`} />
            <BigStat icon={<Smartphone size={18} />} label="Mobile money" value={fmtMoney(data.momoRevenue)} sub="MTN + Airtel" />
            <BigStat icon={<TrendingDown size={18} />} label="Expenses" value={fmtMoney(data.totalExpenses)} sub="in range" />
            <BigStat icon={<Building2 size={18} />} label="Inventory value" value={fmtMoney(data.inventoryValue)} sub={`${data.lowStock.length} low-stock items`} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="font-semibold text-slate-900 mb-2">Daily revenue</h2>
              <MiniBarChart data={data.revenueByDay} />
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="font-semibold text-slate-900 mb-2">Daily expenses</h2>
              <MiniBarChart data={data.expensesByDay} />
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={16} className="text-emerald-600" />
                <h2 className="font-semibold text-slate-900">Top selling drugs</h2>
              </div>
              {data.topDrugs.length ? (
                <ul className="divide-y divide-slate-100">
                  {data.topDrugs.map((d, i) => (
                    <li key={i} className="flex items-center justify-between py-2.5">
                      <span className="flex items-center gap-2 text-sm text-slate-700">
                        <span className="w-6 h-6 rounded bg-emerald-50 text-emerald-700 text-[11px] flex items-center justify-center font-semibold">
                          {i + 1}
                        </span>
                        {d.drugName}
                      </span>
                      <span className="font-mono text-sm text-slate-600">{fmtMoney(d.total)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-slate-400 py-4 text-center">No sales data yet.</div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Users size={16} className="text-emerald-600" />
                <h2 className="font-semibold text-slate-900">Team</h2>
              </div>
              {users.length ? (
                <ul className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <li key={u.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <div className="text-sm font-medium text-slate-800">{u.name}</div>
                        <div className="text-[11px] text-slate-400">Joined {fmtDate(u.createdAt)}</div>
                      </div>
                      <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full capitalize">{u.role.toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-slate-400 py-4 text-center">No team members.</div>
              )}

              {isOwner && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Plan</h3>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold" style={{ color: TIERS[session?.facility?.subscriptionTier || "BASIC"]?.color }}>
                      {TIERS[session?.facility?.subscriptionTier || "BASIC"]?.label}
                    </span>
                    <span className="text-xs text-slate-400">tier</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BigStat({ icon, label, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">{icon}</div>
      <div className="text-xl font-bold text-slate-900">{value}</div>
      <div className="text-sm text-slate-500 font-medium">{label}</div>
      <div className="text-[11px] text-slate-400">{sub}</div>
    </div>
  );
}