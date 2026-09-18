import { useEffect, useState, useCallback } from "react";
import {
  Loader2, Check, CreditCard, Clock, XCircle, Send,
  Smartphone, ShieldCheck, AlertTriangle, Copy,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch } from "../lib/api.js";
import { TIERS, tierMeta } from "../lib/utils.js";

const ugx = (n) => `UGX ${Number(n || 0).toLocaleString("en-UG")}`;
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-UG", { day: "numeric", month: "short", year: "numeric" }) : "—";

const STATUS_META = {
  PENDING: { label: "Awaiting confirmation", icon: Clock, cls: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Approved", icon: Check, cls: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Rejected", icon: XCircle, cls: "bg-red-100 text-red-700" },
};

export default function Billing() {
  const { session } = useAuth();
  const facility = session?.facility;

  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tier, setTier] = useState("BASIC");
  const [months, setMonths] = useState(1);
  const [method, setMethod] = useState("AIRTEL");
  const [transactionRef, setTransactionRef] = useState("");
  const [payerName, setPayerName] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, c, h] = await Promise.all([
        apiFetch("/billing/status"),
        apiFetch("/billing/config"),
        apiFetch("/billing/payment-requests"),
      ]);
      setStatus(s);
      setConfig(c);
      setHistory(h);
      // Preselect the plan the clinic already runs, so a renewal is one tap.
      if (TIERS[s.storedTier]) setTier(s.storedTier);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const quote = TIERS[tier] ? TIERS[tier].priceUgx * months : 0;
  const pending = history.find((h) => h.status === "PENDING");

  async function submitClaim(e) {
    e.preventDefault();
    setError("");
    setSubmitted("");
    setSubmitting(true);
    try {
      await apiFetch("/billing/payment-requests", {
        method: "POST",
        body: JSON.stringify({
          requestedTier: tier,
          months,
          method,
          transactionRef: transactionRef.trim(),
          payerName: payerName.trim() || session?.user?.name,
          payerPhone: payerPhone.trim() || facility?.phone,
        }),
      });
      setTransactionRef("");
      setSubmitted("Payment submitted. We'll verify it and activate your plan shortly.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function copyNumber(number) {
    try {
      await navigator.clipboard.writeText(number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the number is visible on screen anyway */
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <Loader2 className="animate-spin mr-2" size={20} /> Loading billing…
      </div>
    );
  }

  const tierInfo = tierMeta(status?.effectiveTier);
  const tillNumber = config?.airtel?.number;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Billing & subscription</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage your plan and settle payments. Everything is in Ugandan shillings.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Current plan */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Current plan</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xl font-bold text-slate-900">{tierInfo.label}</span>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${tierInfo.colorBadge}`}>
                {status?.readOnly ? "Read-only" : status?.onTrial ? "Free trial" : "Active"}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-1">{tierInfo.tagline}</p>
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {status?.onTrial ? "Trial ends" : "Renews / expires"}
            </div>
            <div className="text-lg font-bold text-slate-900 mt-1">
              {fmtDate(status?.onTrial ? status?.trialEndsAt : status?.subscriptionEndsAt)}
            </div>
          </div>
        </div>

        {status?.readOnly && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-900">
              Your data is safe and reports remain readable. Recording new sales resumes the
              moment a payment is confirmed below.
            </p>
          </div>
        )}
        {status?.suspended && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
            <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">
              This account is suspended. Please contact ClinicSync support before paying.
            </p>
          </div>
        )}
      </div>

      {pending ? (
        <div className="bg-white rounded-2xl border border-amber-200 p-6">
          <div className="flex items-start gap-3">
            <Clock size={20} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold text-slate-900">Payment awaiting confirmation</h2>
              <p className="text-sm text-slate-600 mt-1">
                We've received your {TIERS[pending.requestedTier]?.label || pending.requestedTier} claim of{" "}
                <strong>{ugx(pending.amountUgx)}</strong> for {pending.months} month
                {pending.months === 1 ? "" : "s"} (ref{" "}
                <code className="font-mono text-xs">{pending.transactionRef}</code>). It will be
                verified against the till and activated — no need to submit again.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={submitClaim} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
          <div className="flex items-center gap-2">
            <CreditCard size={20} className="text-emerald-600" />
            <h2 className="font-semibold text-slate-900">Pay & activate</h2>
          </div>

          {/* Step 1 — send the money */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-sm font-semibold text-slate-800">1. Send mobile money</div>
            <div className="mt-3 grid sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMethod("AIRTEL")}
                className={`text-left rounded-lg border p-3 transition ${
                  method === "AIRTEL" ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="text-xs font-semibold text-slate-500">Airtel Money</div>
                <div className="font-mono font-bold text-slate-900 mt-0.5">
                  {config?.airtel?.number || "—"}
                </div>
                <div className="text-xs text-slate-500">{config?.airtel?.name}</div>
              </button>
              <button
                type="button"
                onClick={() => setMethod("MTN")}
                className={`text-left rounded-lg border p-3 transition ${
                  method === "MTN" ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="text-xs font-semibold text-slate-500">MTN MoMo</div>
                <div className="font-mono font-bold text-slate-900 mt-0.5">
                  {config?.mtn?.number || "—"}
                </div>
                <div className="text-xs text-slate-500">{config?.mtn?.name}</div>
              </button>
            </div>
            <button
              type="button"
              onClick={() => copyNumber(method === "AIRTEL" ? config?.airtel?.number : config?.mtn?.number)}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:underline"
            >
              <Copy size={13} /> {copied ? "Copied" : "Copy number"}
            </button>
            {Array.isArray(config?.instructions) && (
              <ol className="mt-3 space-y-1 text-xs text-slate-600 list-decimal list-inside">
                {config.instructions.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            )}
          </div>

          {/* Step 2 — choose the plan */}
          <div>
            <div className="text-sm font-semibold text-slate-800 mb-2">2. Choose plan & duration</div>
            <div className="grid sm:grid-cols-3 gap-2">
              {Object.entries(TIERS).map(([key, t]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTier(key)}
                  className={`rounded-lg border p-3 text-left transition ${
                    tier === key ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="font-semibold text-sm text-slate-900">{t.label}</div>
                  <div className="text-xs text-slate-500">{ugx(t.priceUgx)}/mo</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {t.maxUsers} user seat{t.maxUsers === 1 ? "" : "s"}
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <label className="text-sm text-slate-600">Months</label>
              <select
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {[1, 2, 3, 6, 12].map((m) => (
                  <option key={m} value={m}>
                    {m} month{m === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
              <span className="ml-auto text-sm text-slate-600">
                Total to send: <strong className="text-slate-900 text-base">{ugx(quote)}</strong>
              </span>
            </div>
          </div>

          {/* Step 3 — declare it */}
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-800">3. Enter the transaction details</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Transaction ID <span className="text-red-500">*</span>
                </label>
                <input
                  value={transactionRef}
                  onChange={(e) => setTransactionRef(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="From your confirmation SMS"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name on payment</label>
                <input
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder={session?.user?.name || "Your name"}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone used to pay</label>
                <input
                  value={payerPhone}
                  onChange={(e) => setPayerPhone(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder={facility?.phone || "07xx xxx xxx"}
                />
              </div>
            </div>
          </div>

          {submitted && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 flex items-center gap-2">
              <Check size={16} /> {submitted}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || transactionRef.trim().length < 4}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold transition"
          >
            {submitting ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
            {submitting ? "Submitting…" : "Submit for confirmation"}
          </button>

          <p className="flex items-start gap-2 text-xs text-slate-500">
            <ShieldCheck size={14} className="shrink-0 mt-0.5 text-slate-400" />
            We match your transaction ID against the mobile money statement before activating.
            If it can't be found you'll be told why, and you can resubmit.
          </p>
        </form>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-4">Payment history</h2>
          <div className="divide-y divide-slate-100">
            {history.map((h) => {
              const meta = STATUS_META[h.status] || STATUS_META.PENDING;
              const Icon = meta.icon;
              return (
                <div key={h.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-slate-900">
                        {TIERS[h.requestedTier]?.label || h.requestedTier} · {h.months}mo
                      </span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${meta.cls}`}>
                        <Icon size={11} /> {meta.label}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 font-mono truncate">{h.transactionRef}</div>
                    {h.status === "REJECTED" && h.rejectionReason && (
                      <div className="text-xs text-red-600 mt-1">{h.rejectionReason}</div>
                    )}
                    <div className="text-[11px] text-slate-400 mt-0.5">{fmtDate(h.createdAt)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold text-slate-900 text-sm">{ugx(h.amountUgx)}</div>
                    <div className="text-[11px] text-slate-400">{h.method}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 flex items-start gap-3">
        <Smartphone size={18} className="text-slate-400 shrink-0 mt-0.5" />
        <p className="text-sm text-slate-600">
          Need help or a different payment arrangement? Contact{" "}
          <a href={`https://wa.me/${config?.whatsapp || ""}`} className="font-semibold text-emerald-700 hover:underline">
            {config?.payeeName || "support"} on WhatsApp
          </a>
          . Invoices for annual plans are available on request.
        </p>
      </div>
    </div>
  );
}