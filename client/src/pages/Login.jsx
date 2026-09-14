import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { HeartPulse, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [facilityName, setFacilityName] = useState("Mubogi Pharmacy (Demo)");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(facilityName, pin);
      navigate("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

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
              Offline-first hospital, clinic & pharmaceutical management
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Facility name</label>
              <input
                value={facilityName}
                onChange={(e) => setFacilityName(e.target.value)}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="e.g. Mubogi Pharmacy (Demo)"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Cashier PIN</label>
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                inputMode="numeric"
                pattern="[0-9]*"
                type="password"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 tracking-widest"
                placeholder="••••"
              />
            </div>

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : null}
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-[11px] text-slate-600">
            <strong>Demo logins:</strong>
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