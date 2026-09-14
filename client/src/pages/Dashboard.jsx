import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ShoppingCart,
  Wallet,
  Package,
  TrendingUp,
  Cloud,
  AlertTriangle,
  ArrowRight,
  Flame,
  Users,
} from "lucide-react";
import { apiFetch } from "../lib/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { fmtMoney, fmtDate, TIERS, roleMeta } from "../lib/utils.js";
import { runSync } from "../lib/sync.js";

export default function Dashboard() {
  const { session } = useAuth();
  const [stats, setStats] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const role = session?.user?.role;
  const tier = session?.facility?.subscriptionTier || "BASIC";
  const isOwner = role === "OWNER";
  const isPharmacist = role === "PHARMACIST";

  async function load() {
    try {
      const [d, low] = await Promise.all([apiFetch("/dashboard"), apiFetch("/inventory/low-stock")]);
      setStats(d);
      setLowStock(low);
    } catch {
      /* offline — keep last values */
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg("");
    const res = await runSync();
    setSyncing(false);
    if (res?.offline) setSyncMsg("Offline — changes queued locally.");
    else if (res?.ok) setSyncMsg("Synced with cloud ✓");
    else setSyncMsg("Sync skipped.");
    setTimeout(() => setSyncMsg(""), 4000);
  }

  

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Welcome back, {session?.user?.name?.split(" ")[0]} 👋
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {session?.facility?.name} ·{" "}
            <span className="font-medium" style={{ color: TIERS[tier]?.color }}>
              {TIERS[tier]?.label} plan
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            className="flex items-center gap-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-3 py-2 rounded-lg"
          >
            <Cloud size={16} className={syncing ? "animate-pulse text-emerald-600" : ""} />
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-2.5 rounded-lg">{syncMsg}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <QuickLink to="/pos" title="New Sale" desc="Open POS" icon={ShoppingCart} />
        <QuickLink to="/expenses" title="Log Expense" desc="Track costs" icon={Wallet} />
        <QuickLink to="/inventory" title="Inventory" desc="Stock & reorder" icon={Package} />
        <QuickLink to="/reconciliation" title="End of Day" desc="Balance sheet" icon={TrendingUp} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Stats */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900 mb-4">Overview</h2>
          {stats ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat label="Revenue" value={fmtMoney(stats.totalRevenue)} sub="Last 30 days" />
              <Stat label="Sales" value={String(stats.totalSales)} sub="Transactions" />
              <Stat label="Expected profit" value={fmtMoney(stats.expectedProfit)} sub="Rev − cost of goods" />
              <Stat label="Net" value={fmtMoney(stats.netRevenue)} sub="After expenses" />
            </div>
          ) : (
            <div className="text-sm text-slate-400 py-6 text-center">
              No data yet — make a sale to see analytics.
            </div>
          )}

          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-700">Top selling drugs</h3>
              <Link to="/reports" className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                Reports <ArrowRight size={12} />
              </Link>
            </div>
            {stats?.topDrugs?.length ? (
              <ul className="divide-y divide-slate-100">
                {stats.topDrugs.slice(0, 5).map((d, i) => (
                  <li key={d.drugName} className="flex items-center justify-between py-2">
                    <span className="flex items-center gap-2 text-sm text-slate-700">
                      <span className="w-5 h-5 rounded bg-slate-100 text-[11px] flex items-center justify-center text-slate-500 font-medium">
                        {i + 1}
                      </span>
                      {d.drugName}
                    </span>
                    <span className="text-xs font-mono text-slate-500">{fmtMoney(d.total)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-slate-400">No sales recorded.</div>
            )}
          </div>
        </div>

        {/* Low stock */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-900">Low stock alerts</h2>
            <AlertTriangle size={18} className={lowStock.length ? "text-amber-500" : "text-slate-200"} />
          </div>
          {lowStock.length ? (
            <ul className="space-y-2">
              {lowStock.slice(0, 8).map((item) => (
                <li key={item.id} className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <span className="text-sm text-slate-700">{item.drugName}</span>
                  <span className="text-xs font-mono text-amber-700">
                    {item.quantity} left (min {item.reorderLevel})
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-slate-400 py-6 text-center">Stock levels healthy 🎉</div>
          )}
          <Link
            to="/inventory"
            className="mt-4 block text-center text-sm font-medium text-emerald-600 hover:text-emerald-700"
          >
            Go to inventory
          </Link>
        </div>
      </div>

      {(isOwner || isPharmacist) && (
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Cashier performance */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-900">Cashier performance</h2>
              <Users size={18} className="text-slate-400" />
            </div>
            {stats?.cashiers?.length ? (
              <ul className="divide-y divide-slate-100">
                {stats.cashiers.map((c) => (
                  <li key={c.name} className="flex items-center justify-between py-2">
                    <div>
                      <div className="text-sm font-medium text-slate-800">{c.name}</div>
                      <div className="text-[11px] text-slate-400">{c.sales} sales</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-slate-900">{fmtMoney(c.revenue)}</div>
                      <div className="text-[11px] text-slate-400">
                        cash {fmtMoney(c.cash)} · momo {fmtMoney(c.momo)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-slate-400 py-6 text-center">No cashier sales recorded yet.</div>
            )}
          </div>

          {/* Expiry alerts */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-900">Expiring soon (30 days)</h2>
              <Flame size={18} className={stats?.expiringSoon?.length ? "text-orange-500" : "text-slate-200"} />
            </div>
            {stats?.expiringSoon?.length ? (
              <ul className="space-y-2">
                {stats.expiringSoon.slice(0, 6).map((item) => (
                  <li key={item.id} className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                    <span className="text-sm text-slate-700">{item.drugName}</span>
                    <span className="text-xs font-mono text-orange-700">
                      {item.quantity} left · {fmtDate(item.expiryDate)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-slate-400 py-6 text-center">Nothing expiring soon 🎉</div>
            )}
          </div>
        </div>
      )}

      {isOwner && (
        <div className="bg-slate-900 rounded-xl p-5 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Owner Portal</h2>
              <p className="text-xs text-slate-400 mt-0.5">{stats?.tier?.usersUsed}/{stats?.tier?.maxUsers} team members on the {stats?.tier?.label} plan</p>
            </div>
            <Link
              to="/settings"
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              Manage team & plan <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function QuickLink({ to, title, desc, icon: Icon }) {
  return (
    <Link
      to={to}
      className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md hover:border-emerald-300 transition-all group"
    >
      <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
        <Icon size={20} />
      </div>
      <div className="font-semibold text-slate-900 text-sm">{title}</div>
      <div className="text-xs text-slate-500">{desc}</div>
    </Link>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-900 mt-0.5">{value}</div>
      <div className="text-[11px] text-slate-400">{sub}</div>
    </div>
  );
}