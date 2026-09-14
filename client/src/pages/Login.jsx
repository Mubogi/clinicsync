import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { HeartPulse, Loader2, Building2 } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch } from "../lib/api.js";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [facilities, setFacilities] = useState([]);
  const [facilityId, setFacilityId] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch("/auth/facilities")
      .then((list) => {
        setFacilities(list);
        if (list.length && !facilityName) {
          const first = list[0];
          setFacilityId(first.id);
          setFacilityName(first.name);
          setFacilityDisplay(first);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFacilityDisplay = (f) => {
    if (!f) return;
    setFacilityName(f.name);
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(facilityName, pin, true);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const selected = facilities.find((f) => f.id === facilityId) || null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex flex-col items-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center mb-3">
              <HeartPulse size={30} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">ClinicSync</h1>
            <p className="text-xs text-slate-500 text-center mt-1">
              Offline-first hospital, clinic & pharmacy management
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Facility / Clinic / Pharmacy</label>
              {facilities.length > 0 ? (
                <select
                  value={facilityId}
                  onChange={(e) => {
                    const f = facilities.find((x) => x.id === e.target.value);
                    setFacilityId(e.target.value);
                    setFacilityDisplay(f);
                  }}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                >
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.brandName || f.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={facilityName}
                  onChange={(e) => setFacilityName(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="e.g. Mubogi Pharmacy (Demo)"
                />
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Staff PIN</label>
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                inputMode="numeric"
                pattern="[0-9]*"
                type="password"
                autoFocus
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 tracking-widest"
                placeholder="••••"
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Building2 size={14} />
              <span>
                Sessions are remembered on this device so your staff stay signed in
                (logout is deliberate and available in the sidebar).
              </span>
            </div>

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : null}
              {loading ? "Signing in…" : "Open ClinicSync"}
            </button>
          </form>

          <div className="mt-5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-[11px] text-slate-600">
            <strong>Demo logins</strong>
            <ul className="mt-1 space-y-0.5">
              <li>Owner — PIN <code className="font-mono">1234</code></li>
              <li>Cashier — PIN <code className="font-mono">2345</code></li>
              <li>Pharmacist — PIN <code className="font-mono">3456</code></li>
            </ul>
          </div>
        </div>
        <p className="text-center text-xs text-slate-400 mt-4">
          Jordan Design Hub · Mubogi Gastavas Jordan Tech Ecosystem · Uganda
        </p>
      </div>
    </div>
  );
}