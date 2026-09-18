import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  HeartPulse,
  Building2,
  Search,
  Plus,
  Trash2,
  Check,
  Loader2,
  BookOpen,
  Rocket,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch } from "../lib/api.js";
import { TIERS, fmtMoney } from "../lib/utils.js";
import MedicineLibrary from "../components/MedicineLibrary.jsx";

const UNIT_TYPES = ["Strip of 10", "Strip of 6", "Bottle", "Box", "Tablet", "Sachet"];

// First-time setup: brand the facility, pick a plan and select initial stock
// straight from the Uganda drug library.
export default function Setup() {
  const { session, setSession } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1); // 1 branding→2 plan→3 stock
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [brand, setBrand] = useState({
    brandName: session?.facility?.brandName || session?.facility?.name || "",
    tagline: session?.facility?.tagline || "",
    logoEmoji: session?.facility?.logoEmoji || "",
    address: session?.facility?.address || "",
    phone: session?.facility?.phone || "",
  });
  const [tier, setTier] = useState("BASIC");

  // Selected stock items (from library)
  const [selected, setSelected] = useState([]);
  const [showLibrary, setShowLibrary] = useState(false);

  function addFromLibrary(m) {
    setSelected((prev) => {
      if (prev.some((s) => s.name === m.name)) return prev;
      return [{ ...m, quantity: "50", costPrice: String(m.commonPrices?.costPrice || ""), sellingPrice: String(m.commonPrices?.stripPrice || m.commonPrices?.boxPrice || ""), unitType: m.defaultUnit || "Strip of 10" }, ...prev];
    });
    setShowLibrary(false);
  }

  function updateRow(name, field, value) {
    setSelected((prev) => prev.map((s) => (s.name === name ? { ...s, [field]: value } : s)));
  }

  function removeRow(name) {
    setSelected((prev) => prev.filter((s) => s.name !== name));
  }

  async function finishSetup() {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/auth/facility/setup", {
        method: "POST",
        body: JSON.stringify({
          brandName: brand.brandName,
          tagline: brand.tagline,
          logoEmoji: brand.logoEmoji,
          address: brand.address,
          phone: brand.phone,
          subscriptionTier: tier,
          initialStock: selected.map((s) => ({
            name: s.name,
            genericName: s.genericName,
            unitType: s.unitType,
            quantity: Number(s.quantity) || 0,
            costPrice: Number(s.costPrice || 0),
            sellingPrice: Number(s.sellingPrice || s.costPrice || 0),
            stripsPerBox: s.pack?.stripsPerBox || null,
            tabletsPerStrip: s.pack?.tabletsPerStrip || null,
          })),
        }),
      });
      // Update session so the app knows onboarding is done
      const updatedFacility = res.facility;
      const updatedSession = { ...session, facility: updatedFacility };
      setSession(updatedSession);
      window.localStorage.setItem("clinicsync_session", JSON.stringify(updatedSession));
      window.dispatchEvent(new Event("clinicSync:facility-updated"));
      navigate("/dashboard", { replace: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = useMemo(() => selected.length, [selected]);

  const stepsMeta = [
    { n: 1, label: "Brand" },
    { n: 2, label: "Plan" },
    { n: 3, label: "Stock" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 rounded-2xl bg-emerald-600 flex items-center justify-center">
            <HeartPulse size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Welcome to ClinicSync</h1>
            <p className="text-sm text-slate-500">Let's set up <strong>{session?.facility?.name || "your pharmacy"}</strong> in 3 quick steps.</p>
          </div>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-2 mb-6 mt-6">
          {stepsMeta.map((s, i) => (
            <div key={s.n} className="flex-1 flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  step > s.n
                    ? "bg-emerald-600 text-white"
                    : step === s.n
                      ? "bg-emerald-600 text-white ring-4 ring-emerald-100"
                      : "bg-slate-200 text-slate-500"
                }`}
              >
                {step > s.n ? <Check size={15} /> : s.n}
              </div>
              <span className={`text-sm font-medium capitalize ${step === s.n ? "text-slate-900" : "text-slate-400"}`}>{s.label}</span>
              {i < stepsMeta.length - 1 && <div className={`flex-1 h-0.5 rounded ${step > s.n ? "bg-emerald-500" : "bg-slate-200"}`} />}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          {/* STEP 1: Branding */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="font-bold text-slate-900 text-lg">Facility branding</h2>
              <p className="text-sm text-slate-500 -mt-2">This is what customers see on receipts and your POS header.</p>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Display / brand name *</label>
                  <input
                    value={brand.brandName}
                    onChange={(e) => setBrand({ ...brand, brandName: e.target.value })}
                    className="input"
                    placeholder="e.g. Mubogi Pharmacy"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Logo emoji</label>
                  <input
                    value={brand.logoEmoji}
                    onChange={(e) => setBrand({ ...brand, logoEmoji: e.target.value })}
                    className="input"
                    placeholder="e.g. 💊 🏥 🩺"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Tagline</label>
                  <input
                    value={brand.tagline}
                    onChange={(e) => setBrand({ ...brand, tagline: e.target.value })}
                    className="input"
                    placeholder="e.g. Your community pharmacy, always stocked"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Phone</label>
                  <input
                    value={brand.phone}
                    onChange={(e) => setBrand({ ...brand, phone: e.target.value })}
                    className="input"
                    placeholder="+256 …"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Address</label>
                  <input
                    value={brand.address}
                    onChange={(e) => setBrand({ ...brand, address: e.target.value })}
                    className="input"
                    placeholder="Kampala, Uganda"
                  />
                </div>
              </div>
              <button
                onClick={() => setStep(2)}
                disabled={!brand.brandName}
                className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-50"
              >
                Continue <Rocket size={15} />
              </button>
            </div>
          )}

          {/* STEP 2: Plan */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="font-bold text-slate-900 text-lg">Choose a plan</h2>
              <p className="text-sm text-slate-500 -mt-2">
                You start on a 14-day free trial of Basic. After the trial, Basic is{" "}
                {fmtMoney(TIERS.BASIC.priceUgx)}/month — pay by mobile money from Billing.
                Larger plans are activated by ClinicSync once payment is confirmed.
              </p>
              <div className="grid sm:grid-cols-3 gap-3">
                {Object.entries(TIERS).map(([k, v]) => {
                  const paid = k !== "BASIC";
                  return (
                    <button
                      key={k}
                      onClick={() => !paid && setTier(k)}
                      disabled={paid}
                      className={`text-left border rounded-xl p-4 transition-colors relative ${
                        paid
                          ? "border-slate-200 opacity-60 cursor-not-allowed"
                          : tier === k
                            ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100"
                            : "border-slate-200 hover:border-emerald-300"
                      }`}
                    >
                      {v.popular && (
                        <span className="absolute -top-2 right-3 text-[9px] font-bold bg-amber-400 text-amber-900 px-2 py-0.5 rounded-full uppercase">Popular</span>
                      )}
                      <div className="font-bold" style={{ color: v.color }}>{v.label}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {v.priceUgx === 0 ? "Free" : `${fmtMoney(v.priceUgx)}/mo`}
                        {paid && " · request after setup"}
                      </div>
                      <ul className="mt-2 space-y-1">
                        {v.features.slice(0, 4).map((f) => (
                          <li key={f} className="text-[11px] text-slate-600 flex items-start gap-1.5">
                            <Check size={12} className="text-emerald-500 mt-0.5 shrink-0" /> {f}
                          </li>
                        ))}
                      </ul>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep(1)} className="border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium px-5 py-2.5 rounded-lg">Back</button>
                <button onClick={() => setStep(3)} className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-5 py-2.5 rounded-lg">Continue</button>
              </div>
            </div>
          )}

          {/* STEP 3: Initial stock */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold text-slate-900 text-lg">Initial stock</h2>
                  <p className="text-sm text-slate-500 -mt-1">Pick medicines you already have from the Uganda drug library (or skip and add later).</p>
                </div>
                <button
                  onClick={() => setShowLibrary(true)}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg shrink-0"
                >
                  <BookOpen size={15} /> Add medicines
                </button>
              </div>

              {selectedCount === 0 ? (
                <div className="text-center py-10 border border-dashed border-slate-300 rounded-xl">
                  <HeartPulse size={30} className="text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">No stock yet. Tap “Add medicines” to browse the library.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {selected.map((s) => (
                    <div key={s.name} className="border border-slate-200 rounded-xl p-3 grid md:grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">{s.name}</div>
                        <div className="text-[11px] text-slate-400">{s.genericName} · {s.category}</div>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase">Unit</label>
                        <select value={s.unitType} onChange={(e) => updateRow(s.name, "unitType", e.target.value)} className="text-xs border border-slate-300 rounded px-2 py-1 bg-white">
                          {UNIT_TYPES.map((u) => <option key={u}>{u}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase">Qty</label>
                        <input value={s.quantity} onChange={(e) => updateRow(s.name, "quantity", e.target.value)} type="number" min="0" className="w-16 text-xs border border-slate-300 rounded px-2 py-1" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase">Buy price</label>
                        <input value={s.costPrice} onChange={(e) => updateRow(s.name, "costPrice", e.target.value)} type="number" min="0" className="w-20 text-xs border border-slate-300 rounded px-2 py-1" placeholder="UGX" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 uppercase">Sell price</label>
                        <input value={s.sellingPrice} onChange={(e) => updateRow(s.name, "sellingPrice", e.target.value)} type="number" min="0" className="w-20 text-xs border border-slate-300 rounded px-2 py-1" placeholder="UGX" />
                      </div>
                      <button onClick={() => removeRow(s.name)} className="text-red-400 hover:text-red-600 shrink-0"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  <button onClick={() => setShowLibrary(true)} className="text-sm text-indigo-600 font-medium hover:underline flex items-center gap-1">
                    <Plus size={14} /> Add more…
                  </button>
                </div>
              )}

              {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5 rounded-lg">{error}</div>}

              <div className="flex flex-wrap gap-2 pt-2">
                <button onClick={() => setStep(2)} className="border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium px-5 py-2.5 rounded-lg">Back</button>
                <button
                  onClick={() => {
                    // Skip stock: leave initialStock empty.
                    setSelected([]);
                    finishSetup();
                  }}
                  disabled={busy}
                  className="border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium px-5 py-2.5 rounded-lg disabled:opacity-50"
                >
                  Skip for now
                </button>
                <button
                  onClick={finishSetup}
                  disabled={busy}
                  className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-5 py-2.5 rounded-lg disabled:opacity-50 min-w-[200px]"
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />}
                  {busy ? "Saving…" : "Finish setup"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`.input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 0.5rem; font-size: 0.875rem; } .input:focus { outline: none; border-color: #059669; box-shadow: 0 0 0 2px rgba(5,150,105,0.15); }`}</style>

      {showLibrary && <MedicineLibrary onSelect={addFromLibrary} onClose={() => setShowLibrary(false)} />}
    </div>
  );
}