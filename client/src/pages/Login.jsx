import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { HeartPulse, Loader2, Building2, KeyRound } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch } from "../lib/api.js";

export default function Login() {
  const { login, loginPassword } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("pin");
  const [facilities, setFacilities] = useState([]);
  const [facilityId, setFacilityId] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const [pin, setPin] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
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
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "pin") {
        await login(facilityName, pin, remember);
      } else {
        await loginPassword(username.trim().toLowerCase(), password, remember);
      }
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const switchMode = (next) => {
    setMode(next);
    setError("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 px-4 py-10">
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

          {/* Two distinct audiences: staff at a shared till type a PIN, while the
              owner uses a username/password to manage billing and settings. */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg mb-5">
            {[
              { key: "pin", label: "Staff (PIN)", icon: Building2 },
              { key: "owner", label: "Owner login", icon: KeyRound },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => switchMode(key)}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition ${
                  mode === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "pin" ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Facility / Clinic / Pharmacy</label>
                  {facilities.length > 0 ? (
                    <select
                      value={facilityId}
                      onChange={(e) => {
                        const f = facilities.find((x) => x.id === e.target.value);
                        setFacilityId(e.target.value);
                        if (f) setFacilityName(f.name);
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
                    type="password"
                    autoFocus
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 tracking-widest"
                    placeholder="••••"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    autoFocus
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="e.g. owner"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    autoComplete="current-password"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="••••••••"
                  />
                </div>
              </>
            )}

            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>
                Keep me signed in on this device.
                <span className="block text-slate-400">
                  Leave this off on a shared till or front-desk computer.
                </span>
              </span>
            </label>

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

          <p className="mt-5 text-center text-sm text-slate-500">
            New here?{" "}
            <Link to="/signup" className="text-emerald-700 font-semibold hover:underline">
              Create a clinic
            </Link>
          </p>

          {/* Seeded PINs are for local demos only. Printing them in a production
              build would hand every visitor the demo owner's PIN, so a hosted
              demo must opt in explicitly with VITE_SHOW_DEMO_LOGINS=1. */}
          {(import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_LOGINS === "1") && (
            <div className="mt-5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-[11px] text-slate-600">
              <strong>Demo logins</strong>
              <ul className="mt-1 space-y-0.5">
                <li>Owner — PIN <code className="font-mono">1234</code>, or owner / demo-password</li>
                <li>Cashier — PIN <code className="font-mono">2345</code></li>
                <li>Pharmacist — PIN <code className="font-mono">3456</code></li>
              </ul>
            </div>
          )}
        </div>
        <p className="text-center text-xs text-slate-400 mt-4">
          Jordan Design Hub · Mubogi Gastavas Jordan Tech Ecosystem · Uganda
        </p>
      </div>
    </div>
  );
}