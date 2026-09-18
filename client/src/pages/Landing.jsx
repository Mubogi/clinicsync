import { Link, Navigate } from "react-router-dom";
import {
  HeartPulse, Check, X, WifiOff, ShieldCheck, Receipt,
  PackageSearch, Users, ArrowRight,
} from "lucide-react";
import { TIERS } from "../lib/utils.js";
import { useAuth } from "../context/AuthContext.jsx";

const ugx = (n) => `UGX ${n.toLocaleString("en-UG")}`;

const PILLARS = [
  {
    icon: WifiOff,
    title: "Works with no internet",
    body: "Sales, stock and receipts keep working during a blackout. Everything queues on the device and syncs when the signal returns.",
  },
  {
    icon: ShieldCheck,
    title: "Your data stays yours",
    body: "Each clinic's records are isolated by account and password-hashed. Nothing is shared between pharmacies on the platform.",
  },
  {
    icon: Receipt,
    title: "Money that reconciles",
    body: "End-of-day takings, cash vs mobile money, and per-cashier accountability — so the till balances without guesswork.",
  },
  {
    icon: PackageSearch,
    title: "Stock you can trust",
    body: "Batch and expiry tracking with FEFO ordering, low-stock alerts, and tablet / strip / box pricing that matches how you actually sell.",
  },
];

export default function Landing() {
  const { session, ready } = useAuth();

  // Someone already signed in should not land on the sales pitch. Wait for the
  // session check so we don't flash the marketing page before redirecting.
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-500">
        Loading…
      </div>
    );
  }
  if (session) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="max-w-6xl mx-auto px-5 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center">
            <HeartPulse size={20} className="text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">ClinicSync</span>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <Link to="/login" className="px-4 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition">
            Sign in
          </Link>
          <Link
            to="/signup"
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition"
          >
            Start 14-day trial
          </Link>
        </nav>
      </header>

      <section className="max-w-3xl mx-auto px-5 pt-14 pb-16 text-center">
        <span className="inline-block text-[11px] font-semibold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1">
          Offline-first · Built for Uganda
        </span>
        <h1 className="mt-5 text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
          Run your pharmacy even when
          <span className="text-emerald-400"> the network is down</span>
        </h1>
        <p className="mt-5 text-slate-400 text-lg leading-relaxed">
          ClinicSync is a pharmacy, clinic and drug-shop manager that keeps selling
          offline, tracks every batch and expiry date, and reconciles the day's money
          — on the phone or laptop you already own.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/signup"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-white transition"
          >
            Start your 14-day free trial <ArrowRight size={18} />
          </Link>
          <a
            href="#pricing"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-white/15 hover:bg-white/5 font-semibold transition"
          >
            See pricing
          </a>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          No card needed. Pay by Airtel or MTN mobile money when the trial ends.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-5 pb-16 grid sm:grid-cols-2 gap-4">
        {PILLARS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center mb-4">
              <Icon size={20} className="text-emerald-400" />
            </div>
            <h3 className="font-semibold text-lg">{title}</h3>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">{body}</p>
          </div>
        ))}
      </section>

      <section id="pricing" className="max-w-6xl mx-auto px-5 pb-20 scroll-mt-6">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold tracking-tight">Simple monthly pricing</h2>
          <p className="mt-3 text-slate-400">
            Priced per clinic, billed in Ugandan shillings. Cancel by simply not renewing.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {Object.entries(TIERS).map(([key, tier]) => (
            <div
              key={key}
              className={`relative rounded-2xl p-6 flex flex-col ${
                tier.popular
                  ? "border-2 border-emerald-500 bg-emerald-500/[0.07]"
                  : "border border-white/10 bg-white/[0.03]"
              }`}
            >
              {tier.popular && (
                <span className="absolute -top-3 left-6 text-[11px] font-bold uppercase tracking-wide bg-emerald-600 text-white rounded-full px-3 py-1">
                  Most popular
                </span>
              )}
              <h3 className="text-lg font-bold">{tier.label}</h3>
              <p className="text-sm text-slate-400 mt-1">{tier.tagline}</p>
              <div className="mt-5">
                <span className="text-3xl font-bold">{ugx(tier.priceUgx)}</span>
                <span className="text-slate-400 text-sm"> / month</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Up to {tier.maxUsers} user seat{tier.maxUsers === 1 ? "" : "s"}
                {tier.maxFacilities > 1 ? ` · ${tier.maxFacilities} branches` : ""}
              </p>

              <ul className="mt-5 space-y-2.5 text-sm flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <Check size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                    <span className="text-slate-300">{f}</span>
                  </li>
                ))}
                {tier.whatsMissing.map((f) => (
                  <li key={f} className="flex gap-2.5 text-slate-500">
                    <X size={16} className="shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                to="/signup"
                className={`mt-6 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold transition ${
                  tier.popular
                    ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                    : "border border-white/15 hover:bg-white/5"
                }`}
              >
                Start free trial
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex gap-4">
          <Users size={22} className="text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-sm text-slate-400 leading-relaxed">
            <strong className="text-slate-200">Start on Basic, move up when you grow.</strong>{" "}
            Every plan begins with a 14-day free trial — full features, no payment up
            front. When it ends, your records stay safe and readable; you just can't record
            new sales until you renew. Upgrade or downgrade at any time.
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 py-8">
        <p className="text-center text-xs text-slate-500">
          Jordan Design Hub · Mubogi Gastavas Jordan Tech Ecosystem · Uganda
        </p>
      </footer>
    </div>
  );
}
