import { useEffect, useState } from "react";
import {
  Building2,
  Users,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Ban,
  PlayCircle,
  CalendarPlus,
  X,
  Wallet,
  TrendingUp,
} from "lucide-react";
import { apiFetch } from "../lib/api.js";
import { TIERS, fmtShortMoney, fmtDate, cx } from "../lib/utils.js";

// Operator console for ClinicSync itself — not a clinic-facing screen.
//
// Every route it calls is gated by SYS_ADMIN_IDS on the server (see
// routes/admin.js). If the server has no admin ids configured the API returns
// 403 and this page shows the "not enabled" notice, so it is safe to ship.
export default function Admin() {
  const [facilities, setFacilities] = useState([]);
  const [overview, setOverview] = useState(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [notEnabled, setNotEnabled] = useState(false);

  // Which clinic's billing drawer is open, and the form state for it
  const [openId, setOpenId] = useState(null);
  const [payments, setPayments] = useState({});
  const [form, setForm] = useState({ tier: "PREMIUM", months: 1, amountUgx: "", note: "" });

  async function load() {
    setBusy(true);
    setErr("");
    try {
      const [fs, ov] = await Promise.all([
        apiFetch("/admin/facilities"),
        apiFetch("/admin/overview"),
      ]);
      setFacilities(fs);
      setOverview(ov);
      setNotEnabled(false);
    } catch (e) {
      if (/not enabled|Platform admin/i.test(e.message)) setNotEnabled(true);
      else setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function openDrawer(f) {
    setOpenId(f.id);
    setMsg("");
    setErr("");
    setForm({
      tier: f.storedTier === "BASIC" ? "PREMIUM" : f.storedTier,
      months: 1,
      amountUgx: String(TIERS[f.storedTier === "BASIC" ? "PREMIUM" : f.storedTier]?.priceUgx || ""),
      note: "",
    });
    try {
      const data = await apiFetch(`/admin/facilities/${f.id}/payments`);
      setPayments((p) => ({ ...p, [f.id]: data }));
    } catch (e) {
      setErr(e.message);
    }
  }

  async function activate(id) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const amount = Number(form.amountUgx) || 0;
      await apiFetch(`/admin/facilities/${id}/subscription`, {
        method: "POST",
        body: JSON.stringify({
          tier: form.tier,
          months: Number(form.months),
          amountUgx: amount,
          note: form.note,
        }),
      });
      setMsg(`Activated ${form.tier} for ${form.months} month(s).`);
      await load();
      const data = await apiFetch(`/admin/facilities/${id}/payments`);
      setPayments((p) => ({ ...p, [id]: data }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function setSuspended(id, suspended) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const reason = suspended
        ? window.prompt("Reason shown to the clinic when they try to use ClinicSync:") || undefined
        : undefined;
      if (suspended && reason === undefined) return;
      await apiFetch(`/admin/facilities/${id}/suspension`, {
        method: "PATCH",
        body: JSON.stringify({ suspended, reason }),
      });
      setMsg(suspended ? "Clinic suspended." : "Clinic reactivated.");
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const filtered = facilities.filter((f) =>
    f.name.toLowerCase().includes(query.toLowerCase())
  );

  if (notEnabled) {
    return (
      <div className="p-6 max-w-2xl">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h1 className="font-semibold text-amber-900 flex items-center gap-2">
            <AlertTriangle size={18} /> Platform admin is not enabled
          </h1>
          <p className="text-sm text-amber-800 mt-2">
            Set <code className="bg-amber-100 px-1 rounded">SYS_ADMIN_IDS</code> on the server to
            your user id to enable this console. Until then nobody can manage other clinics, which
            is the safe default.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Building2 size={20} className="text-emerald-600" /> ClinicSync Admin
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Activate plans, extend time frames, and suspend clinics.
          </p>
        </div>
        <button
          onClick={load}
          disabled={busy}
          className="flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={15} className={busy ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-4 py-2.5 flex items-center gap-2">
          <CheckCircle2 size={15} /> {msg}
        </div>
      )}
      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2.5">
          {err}
        </div>
      )}

      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Clinics" value={overview.facilityCount} />
          <Stat label="Paying" value={overview.activePaying} tone="emerald" />
          <Stat label="Lapsed" value={overview.lapsed} tone={overview.lapsed ? "amber" : undefined} />
          <Stat
            label="MRR"
            value={fmtShortMoney(overview.mrrUgx)}
            sub={`${fmtShortMoney(overview.collectedUgx)} collected`}
            tone="emerald"
            icon={<TrendingUp size={14} />}
          />
        </div>
      )}

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clinics…"
          className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      <div className="space-y-3">
        {filtered.map((f) => {
          const stored = TIERS[f.storedTier] || TIERS.BASIC;
          const isOpen = openId === f.id;
          const lapsed = f.expired || f.suspended;
          return (
            <div key={f.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-4 flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900 truncate">{f.name}</span>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide"
                      style={{ background: `${stored.color}1a`, color: stored.color }}
                    >
                      {stored.label}
                    </span>
                    {f.suspended && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 uppercase">
                        Suspended
                      </span>
                    )}
                    {!f.suspended && f.expired && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 uppercase">
                        Expired
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Users size={12} /> {f.userCount} users
                    </span>
                    <span>{f.saleCount} sales</span>
                    <span>{f.inventoryCount} items</span>
                    {f.subscriptionEndsAt && (
                      <span
                        className={cx(
                          "flex items-center gap-1",
                          lapsed ? "text-amber-700 font-medium" : "text-slate-600"
                        )}
                      >
                        <CalendarPlus size={12} /> Ends {fmtDate(f.subscriptionEndsAt)}
                        {typeof f.daysRemaining === "number" &&
                          ` (${f.daysRemaining > 0 ? `${f.daysRemaining}d left` : "past due"})`}
                      </span>
                    )}
                  </div>
                  {f.suspendedReason && (
                    <div className="text-xs text-red-600 mt-1">Reason: {f.suspendedReason}</div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => (isOpen ? setOpenId(null) : openDrawer(f))}
                    className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 flex items-center gap-1.5"
                  >
                    <Wallet size={14} /> Billing
                  </button>
                  {f.suspended ? (
                    <button
                      onClick={() => setSuspended(f.id, false)}
                      disabled={busy}
                      className="text-sm bg-emerald-600 text-white rounded-lg px-3 py-1.5 hover:bg-emerald-700 flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <PlayCircle size={14} /> Reactivate
                    </button>
                  ) : (
                    <button
                      onClick={() => setSuspended(f.id, true)}
                      disabled={busy}
                      className="text-sm border border-red-200 text-red-600 rounded-lg px-3 py-1.5 hover:bg-red-50 flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Ban size={14} /> Suspend
                    </button>
                  )}
                </div>
              </div>

              {isOpen && (
                <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-4">
                  <div className="grid sm:grid-cols-4 gap-3">
                    <Field label="Plan">
                      <select
                        value={form.tier}
                        onChange={(e) => setForm({ ...form, tier: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                      >
                        <option value="PREMIUM">Premium</option>
                        <option value="PRO">Pro</option>
                      </select>
                    </Field>
                    <Field label="Months">
                      <input
                        type="number"
                        min="1"
                        max="36"
                        value={form.months}
                        onChange={(e) => setForm({ ...form, months: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                      />
                    </Field>
                    <Field label="Amount paid (UGX)">
                      <input
                        type="number"
                        min="0"
                        value={form.amountUgx}
                        onChange={(e) => setForm({ ...form, amountUgx: e.target.value })}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                      />
                    </Field>
                    <Field label="Note">
                      <input
                        value={form.note}
                        onChange={(e) => setForm({ ...form, note: e.target.value })}
                        placeholder="e.g. Mobile money ref"
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                      />
                    </Field>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => activate(f.id)}
                      disabled={busy}
                      className="text-sm bg-emerald-600 text-white rounded-lg px-4 py-2 hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <CalendarPlus size={14} /> Activate / extend
                    </button>
                    <button
                      onClick={() => openDrawer(f)}
                      disabled={busy}
                      className="text-sm border border-slate-200 rounded-lg px-3 py-2 hover:bg-white flex items-center gap-1.5"
                    >
                      <RefreshCw size={14} /> Reload history
                    </button>
                    <button
                      onClick={() => setOpenId(null)}
                      className="text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1"
                    >
                      <X size={14} /> Close
                    </button>
                    <span className="text-xs text-slate-500 ml-auto">
                      Extends from the current period end, so early renewal adds time.
                    </span>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-slate-600 mb-2">
                      Payment history
                      {payments[f.id]?.totalUgx
                        ? ` · ${fmtShortMoney(payments[f.id].totalUgx)} collected`
                        : ""}
                    </div>
                    {payments[f.id]?.payments?.length ? (
                      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-56 overflow-auto">
                        {payments[f.id].payments.map((p) => (
                          <div
                            key={p.id}
                            className="px-3 py-2 text-xs flex items-center justify-between gap-3"
                          >
                            <span className="font-medium text-slate-700">
                              {TIERS[p.tier]?.label} · {p.months}mo
                            </span>
                            <span className="text-slate-500">
                              {fmtDate(p.periodStart)} → {fmtDate(p.periodEnd)}
                            </span>
                            <span className="font-medium text-slate-800">
                              {fmtShortMoney(p.amountUgx)}
                            </span>
                            <span className="text-slate-400">{fmtDate(p.createdAt)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400">No payments recorded yet.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && !busy && (
          <div className="text-sm text-slate-500 text-center py-8">No clinics found.</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone, icon }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <div className="text-[11px] text-slate-500 flex items-center gap-1">
        {icon} {label}
      </div>
      <div
        className={cx(
          "text-lg font-bold mt-0.5",
          tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-slate-900"
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] text-slate-500 block mb-1">{label}</span>
      {children}
    </label>
  );
}