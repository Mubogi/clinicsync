import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { HeartPulse, Loader2, Check, X } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch } from "../lib/api.js";

// Mirrors the server's OWNER_PIN validation so the user gets instant feedback
// instead of a round trip. The server remains the authority — this only avoids
// a needless failed submit.
function pinProblem(pin) {
  const s = String(pin ?? "");
  if (!/^\d{4,8}$/.test(s)) return "Must be 4 to 8 digits.";
  if (/^(\d)\1+$/.test(s)) return "Avoid using the same digit repeatedly.";
  if (["1234", "0123", "0000", "1111", "12345678", "87654321"].includes(s)) {
    return "That PIN is too easy to guess. Please choose another.";
  }
  return null;
}

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    facilityName: "",
    ownerName: "",
    email: "",
    phone: "",
    username: "",
    password: "",
    confirmPassword: "",
    ownerPin: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tillPin, setTillPin] = useState("");
  const [tillLoading, setTillLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Local pre-checks so the most common mistakes are caught before submitting.
  const passwordTooShort = form.password.length > 0 && form.password.length < 8;
  const passwordMismatch = form.confirmPassword.length > 0 && form.password !== form.confirmPassword;
  const usernameInvalid = form.username.length > 0 && !/^[a-z0-9_.]{3,}$/.test(form.username.toLowerCase());
  const pinIssue = form.ownerPin.length > 0 ? pinProblem(form.ownerPin) : null;
  const canSubmit =
    form.facilityName.trim() &&
    form.ownerName.trim() &&
    form.username &&
    form.password.length >= 8 &&
    form.password === form.confirmPassword &&
    !pinProblem(form.ownerPin);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signup({
        facilityName: form.facilityName.trim(),
        ownerName: form.ownerName.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        username: form.username.trim().toLowerCase(),
        password: form.password,
        ownerPin: form.ownerPin,
      });
      navigate("/setup");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadTill() {
    setTillLoading(true);
    try {
      const cfg = await apiFetch("/billing/config");
      setTillPin(cfg.airtel?.number || "");
    } catch {
      setError("Could not load payment details. Check your connection and try again.");
    } finally {
      setTillLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex flex-col items-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center mb-3">
              <HeartPulse size={30} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Create your clinic</h1>
            <p className="text-xs text-slate-500 text-center mt-1">
              Start with 14 days free. No card required.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Clinic / pharmacy name" required>
              <input
                value={form.facilityName}
                onChange={set("facilityName")}
                className={inputCls}
                placeholder="e.g. Sunrise Pharmacy"
                autoFocus
              />
            </Field>

            <Field label="Your name (owner)" required>
              <input value={form.ownerName} onChange={set("ownerName")} className={inputCls} placeholder="e.g. Grace Namono" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone">
                <input value={form.phone} onChange={set("phone")} className={inputCls} placeholder="07xx xxx xxx" inputMode="tel" />
              </Field>
              <Field label="Email">
                <input value={form.email} onChange={set("email")} type="email" className={inputCls} placeholder="optional" />
              </Field>
            </div>

            <Field label="Username" required hint="Used to sign in and manage billing.">
              <input value={form.username} onChange={set("username")} className={inputCls} placeholder="e.g. grace" autoComplete="username" />
              {usernameInvalid && <Hint tone="bad">At least 3 characters — letters, numbers, dot or underscore only.</Hint>}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Password" required>
                <input
                  value={form.password}
                  onChange={set("password")}
                  type="password"
                  className={inputCls}
                  autoComplete="new-password"
                />
                {passwordTooShort && <Hint tone="bad">Use at least 8 characters.</Hint>}
              </Field>
              <Field label="Confirm" required>
                <input
                  value={form.confirmPassword}
                  onChange={set("confirmPassword")}
                  type="password"
                  className={inputCls}
                  autoComplete="new-password"
                />
                {passwordMismatch && <Hint tone="bad">Passwords don't match.</Hint>}
                {!passwordMismatch && form.password && form.password === form.confirmPassword && (
                  <Hint tone="good"><Check size={12} className="inline -mt-0.5" /> Match</Hint>
                )}
              </Field>
            </div>

            <Field label="Till PIN" required hint="4–8 digits your staff type on the sales screen. Keep it different from your password.">
              <input
                value={form.ownerPin}
                onChange={(e) => setForm((f) => ({ ...f, ownerPin: e.target.value.replace(/\D/g, "").slice(0, 8) }))}
                className={`${inputCls} tracking-[0.5em] font-mono`}
                placeholder="••••"
                inputMode="numeric"
              />
              {pinIssue && <Hint tone="bad">{pinIssue}</Hint>}
              {!pinIssue && form.ownerPin.length >= 4 && <Hint tone="good"><Check size={12} className="inline -mt-0.5" /> Good PIN</Hint>}
            </Field>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors"
            >
              {loading && <Loader2 size={18} className="animate-spin" />}
              {loading ? "Creating your clinic…" : "Create clinic & start trial"}
            </button>
          </form>

          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
            <button type="button" onClick={loadTill} className="font-semibold text-emerald-700 hover:underline">
              {tillLoading ? "Loading…" : "How do I pay later?"}
            </button>
            {tillPin && (
              <p className="mt-1.5">
                Send mobile money to <strong className="font-mono">{tillPin}</strong> (JD Hub), then submit the
                transaction ID in the app. You'll do this once your trial ends.
              </p>
            )}
          </div>

          <p className="mt-5 text-center text-sm text-slate-500">
            Already have an account?{" "}
            <Link to="/login" className="text-emerald-700 font-semibold hover:underline">
              Sign in
            </Link>
          </p>
          <p className="mt-2 text-center text-xs text-slate-400">
            Not ready yet?{" "}
            <Link to="/" className="hover:underline">See what ClinicSync does</Link>
          </p>
        </div>
        <p className="text-center text-xs text-slate-400 mt-4">
          Jordan Design Hub · Mubogi Gastavas Jordan Tech Ecosystem · Uganda
        </p>
      </div>
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500";

function Field({ label, children, required, hint }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

function Hint({ children, tone }) {
  const cls = tone === "bad" ? "text-red-600" : "text-emerald-600";
  return <p className={`text-[11px] mt-1 ${cls}`}>{children}</p>;
}