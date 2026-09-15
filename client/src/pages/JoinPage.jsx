import { useState, useEffect } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { HeartPulse, UserPlus, Loader2, ArrowLeft } from "lucide-react";
import { apiFetch } from "../lib/api.js";

export default function JoinPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const invite = params.get("invite") || "";

  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(null);
  const [facilityName, setFacilityName] = useState("");

  // Best-effort: show who is inviting (public lookup isn't available, so we only
  // know after a successful join. We show the invite's generic info before that.)

  useEffect(() => {
    if (!invite) setError("This invite link is missing its code. Please use the full link the owner sent you.");
  }, [invite]);

  async function handleJoin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const d = await fetch("/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite, name, pinCode: pin }),
      });
      const data = await d.json().catch(() => ({}));
      if (!d.ok) {
        setError(data.error || "Could not join. The invite may be invalid or expired.");
        return;
      }
      setJoined(data);
      setFacilityName(data.facility?.brandName || data.facility?.name || "the pharmacy");
    } catch (err) {
      setError(err.message || "Network error — are you online?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-900 via-slate-900 to-emerald-900 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex flex-col items-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center mb-3">
              <UserPlus size={30} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              {joined ? "You're in! 🎉" : "Join your pharmacy team"}
            </h1>
            <p className="text-xs text-slate-500 text-center mt-1">
              {joined ? `Welcome to ${facilityName}.` : "You were invited by your pharmacy owner. Set up your PIN to start."}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5 rounded-lg mb-4">{error}</div>
          )}

          {joined ? (
            <div className="space-y-4 text-center">
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3 rounded-lg">
                <div className="font-semibold mb-1">{joined.user?.name} · {joined.user?.role}</div>
                <div className="text-xs">Your PIN is ready. Next time you open ClinicSync pick the facility below and use it.</div>
              </div>
              <Link
                to="/login"
                className="block bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 rounded-lg text-center"
              >
                Go to login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleJoin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Your name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. Sandra (Pharmacist)"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Choose a PIN (4+ digits)</label>
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  required
                  inputMode="numeric"
                  pattern="[0-9]{4,}"
                  placeholder="••••"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !invite}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                {loading ? "Joining…" : "Join team"}
              </button>
            </form>
          )}

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <HeartPulse size={13} /> ClinicSync
            {!joined && (
              <Link to="/login" className="ml-2 inline-flex items-center gap-1 text-indigo-600 font-medium hover:underline">
                <ArrowLeft size={12} /> Back to login
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}