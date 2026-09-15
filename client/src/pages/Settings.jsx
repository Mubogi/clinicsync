import { useEffect, useState } from "react";
import {
  Building2,
  Users,
  Shield,
  KeyRound,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  LogOut,
  UserPlus,
  Hash,
  Link2,
  Check,
  Copy,
  MessageCircle,
  ClipboardList,
  CheckSquare,
  XCircle,
  Clock,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch } from "../lib/api.js";
import { ROLES, roleMeta, TIERS, fmtDate, cx } from "../lib/utils.js";

export default function Settings() {
  const { session, logout } = useAuth();
  const role = session?.user?.role;

  // Users
  const [users, setUsers] = useState([]);
  const [plan, setPlan] = useState(null);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("CASHIER");
  const [newPin, setNewPin] = useState("");
  const [resetPins, setResetPins] = useState({}); // userId -> pending new pin
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // Branding
  const [brandName, setBrandName] = useState(session?.facility?.brandName || "");
  const [tagline, setTagline] = useState(session?.facility?.tagline || "");
  const [logoEmoji, setLogoEmoji] = useState(session?.facility?.logoEmoji || "");
  const [address, setAddress] = useState(session?.facility?.address || "");
  const [phone, setPhone] = useState(session?.facility?.phone || "");

  const [busy, setBusy] = useState(false);

  // Invites (owner only)
  const [invites, setInvites] = useState([]);
  const [inviteRole, setInviteRole] = useState("CASHIER");
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState(false);

  // Delete-approval queue (owner approves, staff see their own)
  const [approvals, setApprovals] = useState([]);
  const isOwner = role === "OWNER";

  const loadInvites = async () => {
    if (!isOwner) return;
    try {
      const d = await apiFetch("/team/invites");
      setInvites(Array.isArray(d) ? d : []);
    } catch {
      /* non-fatal */
    }
  };

  const loadApprovals = async () => {
    try {
      const d = await apiFetch("/approvals/requests");
      setApprovals(Array.isArray(d) ? d : []);
    } catch {
      /* non-fatal */
    }
  };

  async function createInvite() {
    setBusy(true);
    try {
      const d = await apiFetch("/team/invites", {
        method: "POST",
        body: JSON.stringify({ role: inviteRole }),
      });
      const full = `${window.location.origin}${d.link}`;
      setInviteLink(full);
      loadInvites();
    } catch (e) {
      flash(false, e.message);
    } finally {
      setBusy(false);
    }
  }

  function copyInvite() {
    navigator.clipboard?.writeText(inviteLink).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function revokeInvite(id) {
    try {
      await apiFetch(`/team/invites/${id}`, { method: "DELETE" });
      loadInvites();
    } catch (e) {
      flash(false, e.message);
    }
  }

  async function decideApproval(id, decision) {
    try {
      await apiFetch(`/approvals/requests/${id}/${decision}`, { method: "POST" });
      loadApprovals();
      flash(true, decision === "approve" ? "Approved — item deleted." : "Request rejected.");
    } catch (e) {
      flash(false, e.message);
    }
  }

  const loadUsers = async () => {
    try {
      const d = await apiFetch("/auth/users");
      setUsers(d.users || []);
      setPlan(d.plan || null);
    } catch (e) {
      setErr(e.message);
    }
  };

  useEffect(() => {
    loadUsers();
    loadInvites();
    loadApprovals();
  }, []);

  const flash = (ok, txt) => {
    if (ok) {
      setMsg(txt);
      setErr("");
    } else {
      setErr(txt);
      setMsg("");
    }
    setTimeout(() => {
      setMsg("");
      setErr("");
    }, 4000);
  };

  const canAdd = plan && users.filter((u) => u.active).length < plan.maxUsers;

  async function addUser(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const d = await apiFetch("/auth/users", {
        method: "POST",
        body: JSON.stringify({ name: newName, role: newRole, pinCode: newPin }),
      });
      flash(true, `Added ${d.name} (PIN ${newPin}). Save this PIN for them.`);
      setNewName("");
      setNewPin("");
      loadUsers();
    } catch (e2) {
      flash(false, e2.message);
    } finally {
      setBusy(false);
    }
  }

  async function resetPin(userId) {
    const pin = resetPins[userId];
    if (!pin) return;
    setBusy(true);
    try {
      await apiFetch(`/auth/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ pinCode: pin }),
      });
      flash(true, `PIN reset to ${pin}`);
      setResetPins((p) => ({ ...p, [userId]: "" }));
    } catch (e) {
      flash(false, e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeUser(userId, name) {
    if (!window.confirm(`Remove ${name}? They will no longer be able to log in (their past sales are kept).`)) return;
    setBusy(true);
    try {
      await apiFetch(`/auth/users/${userId}`, { method: "DELETE" });
      flash(true, `Removed ${name}.`);
      loadUsers();
    } catch (e) {
      flash(false, e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveBranding(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await apiFetch("/auth/facility/branding", {
        method: "PATCH",
        body: JSON.stringify({ brandName, tagline, logoEmoji, address, phone }),
      });
      // update the in-memory + persisted session so the whole UI reflects it
      session.facility = updated;
      window.localStorage.setItem(
        "clinicsync_session",
        JSON.stringify({ user: session.user, facility: updated })
      );
      flash(true, "Facility branding saved.");
      window.dispatchEvent(new Event("clinicSync:facility-updated"));
    } catch (e) {
      flash(false, e.message);
    } finally {
      setBusy(false);
    }
  }

  const currentTier = session?.facility?.subscriptionTier || plan?.tier || "BASIC";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Manage your team, facility branding and subscription.</p>
      </div>

      {(msg || err) && (
        <div className={`text-sm px-4 py-2.5 rounded-lg ${msg ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {msg || err}
        </div>
      )}

      {/* Users */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-slate-400" />
            <h2 className="font-semibold text-slate-900">Team members</h2>
          </div>
          {plan && (
            <span className="text-xs text-slate-500">
              {users.filter((u) => u.active).length}/{plan.maxUsers} users used on{" "}
              <span style={{ color: TIERS[plan.tier]?.color }}>{TIERS[plan.tier]?.label}</span> plan
            </span>
          )}
        </div>

        <div className="divide-y divide-slate-50">
          {users.map((u) => {
            const meta = roleMeta(u.role);
            const isSelf = u.id === session?.user?.id;
            return (
              <div key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
                  {u.name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-[140px]">
                  <div className="text-sm font-medium text-slate-800">
                    {u.name} {isSelf && <span className="text-[10px] text-slate-400 font-normal">(you)</span>}
                    {!u.active && <span className="ml-2 text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">removed</span>}
                  </div>
                  <div className="text-xs flex items-center gap-1.5">
                    <span className={cx("px-1.5 py-0.5 rounded font-medium", meta.badge)}>{meta.label}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!u.active ? (
                    <button
                      onClick={async () => {
                        try {
                          await apiFetch(`/auth/users/${u.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ active: true }),
                          });
                          flash(true, `${u.name} reactivated.`);
                          loadUsers();
                        } catch (e2) {
                          flash(false, e2.message);
                        }
                      }}
                      className="text-xs text-emerald-600 font-medium hover:underline"
                    >
                      Reactivate
                    </button>
                  ) : (
                    <>
                      <div className="flex items-center gap-1">
                        <input
                          value={resetPins[u.id] || ""}
                          onChange={(e) => setResetPins((p) => ({ ...p, [u.id]: e.target.value }))}
                          inputMode="numeric"
                          placeholder="New PIN"
                          className="w-24 px-2 py-1.5 border border-slate-300 rounded-lg text-sm tracking-widest"
                        />
                        <button
                          onClick={() => resetPin(u.id)}
                          disabled={!resetPins[u.id] || busy}
                          className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline disabled:opacity-40"
                        >
                          <KeyRound size={13} /> Set
                        </button>
                      </div>
                      {!isSelf && (
                        <button
                          onClick={() => removeUser(u.id, u.name)}
                          disabled={busy}
                          className="flex items-center gap-1 text-xs font-medium text-red-600 hover:underline disabled:opacity-40"
                        >
                          <Trash2 size={13} /> Remove
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-xl">
          <form onSubmit={addUser} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                placeholder="e.g. David (Cashier)"
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-44"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                {Object.entries(ROLES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">PIN</label>
              <input
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                inputMode="numeric"
                pattern="[0-9]{4,}"
                required
                placeholder="4+ digits"
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-24 tracking-widest"
              />
            </div>
            <button
              type="submit"
              disabled={!canAdd || busy}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              <UserPlus size={15} /> Add user
            </button>
            {!canAdd && (
              <span className="text-xs text-amber-600">
                Plan limit reached — upgrade to PRO or remove a user first.
              </span>
            )}
          </form>
          <p className="text-[11px] text-slate-400 mt-2">
            When you add a user, you are shown their PIN once. Write it down / save it for them. They can change it later.
          </p>
        </div>
      </div>

      {/* Branding */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <Building2 size={18} className="text-slate-400" />
          <h2 className="font-semibold text-slate-900">Facility branding</h2>
          <span className="text-[11px] text-slate-400">Shown across receipts, POS and the sidebar</span>
        </div>
        <form onSubmit={saveBranding} className="px-5 py-4 grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Display name (brand)</label>
            <input value={brandName} onChange={(e) => setBrandName(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-full" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Tagline</label>
            <input value={tagline} onChange={(e) => setTagline(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-full" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Logo emoji</label>
            <input value={logoEmoji} onChange={(e) => setLogoEmoji(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-full" placeholder="e.g. 🏥 / 💊" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-full" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Address</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-full" />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
              <CheckCircle2 size={15} /> Save branding
            </button>
          </div>
        </form>
      </div>

      {/* Staff invites — owner generates a link/QR code */}
      {isOwner && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <Link2 size={18} className="text-slate-400" />
            <h2 className="font-semibold text-slate-900">Invite staff by link</h2>
            <span className="text-[11px] text-slate-400">No passwords to remember — tap the link on their phone</span>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-[11px] font-medium text-slate-500">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="CASHIER">Cashier</option>
                <option value="PHARMACIST">Pharmacist</option>
              </select>
              <button
                onClick={createInvite}
                disabled={busy}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                <Link2 size={15} /> Generate link
              </button>
            </div>

            {inviteLink && (
              <div className="flex flex-wrap items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                <div className="bg-white p-2 rounded-lg border border-emerald-100 shrink-0">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(inviteLink)}`}
                    alt="Staff invite QR code"
                    className="w-24 h-24"
                  />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <div className="text-xs font-medium text-slate-700 mb-1">Scan with their phone — opens the join page:</div>
                  <code className="text-xs text-emerald-800 break-all">{inviteLink}</code>
                </div>
                <button
                  onClick={copyInvite}
                  className="text-xs font-medium text-emerald-700 hover:underline flex items-center gap-1 shrink-0"
                >
                  {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                </button>
              </div>
            )}

            {invites.length > 0 && (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-4 py-2">Invite</th>
                      <th className="px-4 py-2">Role</th>
                      <th className="px-4 py-2">Expires</th>
                      <th className="px-4 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {invites.map((inv) => (
                      <tr key={inv.id}>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">
                          …{inv.token.slice(0, 10)}… {inv.usesLeft === 0 && <span className="text-amber-600 font-medium">(used)</span>}
                        </td>
                        <td className="px-4 py-2 text-xs">{inv.role}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">{fmtDate(inv.expiresAt)}</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => revokeInvite(inv.id)} className="text-xs text-red-500 hover:underline">Revoke</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-slate-400">
              The link expires in 14 days and can be used once. It joins them directly to <strong>{session?.facility?.brandName || "this pharmacy"}</strong> — no clinic picking.
            </p>
          </div>
        </div>
      )}

      {/* Delete-approval queue */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardList size={18} className="text-slate-400" />
            <h2 className="font-semibold text-slate-900">
              {isOwner ? "Delete approvals" : "My delete requests"}
            </h2>
          </div>
          {approvals.filter((a) => a.status === "PENDING").length > 0 && (
            <span className="text-[11px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              {approvals.filter((a) => a.status === "PENDING").length} pending
            </span>
          )}
        </div>
        <div className="px-5 py-4 space-y-2">
          {approvals.length === 0 ? (
            <div className="text-sm text-slate-400 py-4 text-center">
              {isOwner
                ? "No delete requests yet. When staff ask to remove a sale/expense, the request appears here for you to approve or reject."
                : "You haven't requested any deletions. Deletes you request go to the owner for approval."}
            </div>
          ) : (
            approvals.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 border border-slate-100 rounded-lg p-3">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                  {a.status === "PENDING" ? <Clock size={15} className="text-amber-500" /> : a.status === "APPROVED" ? <CheckSquare size={15} className="text-emerald-600" /> : <XCircle size={15} className="text-red-400" />}
                </div>
                <div className="flex-1 min-w-[180px]">
                  <div className="text-sm font-medium text-slate-800">
                    {a.kind} · <span className="font-mono text-xs">{a.targetId?.slice(0, 8)}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    “{a.reason}” — requested by {a.requestedBy || "—"} on {fmtDate(a.createdAt)}
                    {a.status !== "PENDING" && <span className="text-slate-400"> · {a.approvedBy} {a.status === "APPROVED" ? "approved" : "rejected"}</span>}
                  </div>
                </div>
                {a.status === "PENDING" && isOwner && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => decideApproval(a.id, "approve")}
                      className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                    >
                      <CheckSquare size={13} /> Approve & delete
                    </button>
                    <button
                      onClick={() => decideApproval(a.id, "reject")}
                      className="flex items-center gap-1 border border-slate-300 text-slate-600 hover:bg-slate-50 text-xs font-medium px-3 py-1.5 rounded-lg"
                    >
                      <XCircle size={13} /> Reject
                    </button>
                  </div>
                )}
                {a.status === "PENDING" && !isOwner && (
                  <span className="text-[11px] text-amber-600 bg-amber-50 px-2 py-1 rounded-full">Waiting for owner</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Subscription / plan */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <Shield size={18} className="text-slate-400" />
          <h2 className="font-semibold text-slate-900">Subscription plan</h2>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">
                Current: <span style={{ color: TIERS[currentTier]?.color }}>{TIERS[currentTier]?.label}</span>
              </div>
              <p className="text-xs text-slate-500">Feature limits and gating are enforced by your plan.</p>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            {Object.entries(TIERS).map(([k, v]) => {
              const isCurrent = k === currentTier;
              return (
                <div
                  key={k}
                  className={`text-left border rounded-xl p-4 transition-colors relative ${isCurrent ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-emerald-300"}`}
                >
                  {v.popular && !isCurrent && (
                    <span className="absolute -top-2 right-3 text-[9px] font-bold bg-amber-400 text-amber-900 px-2 py-0.5 rounded-full uppercase tracking-wide">Most popular</span>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900" style={{ color: v.color }}>{v.label}</span>
                    {isCurrent && <CheckCircle2 size={16} className="text-emerald-600" />}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    UGX {v.priceUgx === 0 ? "0 / mo" : `${Math.round(v.priceUgx / 1000)}k / mo`} · {v.maxUsers} user{v.maxUsers > 1 ? "s" : ""} · {v.maxProducts === 5000 ? "∞" : v.maxProducts} products
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">{v.tagline}</div>
                  <ul className="mt-3 space-y-1">
                    {v.features.map((f) => (
                      <li key={f} className="text-[11px] text-slate-600 flex items-start gap-1.5">
                        <Check size={12} className="text-emerald-500 mt-0.5 shrink-0" /> {f}
                      </li>
                    ))}
                    {v.whatsMissing && v.whatsMissing.length > 0 && (
                      <li className="text-[10px] text-slate-400 pt-1 italic">Missing: {v.whatsMissing.join(" · ")}</li>
                    )}
                  </ul>
                  {!isCurrent && (
                    <button
                      onClick={async () => {
                        try {
                          setBusy(true);
                          const updated = await apiFetch("/auth/facility/tier", {
                            method: "PATCH",
                            body: JSON.stringify({ subscriptionTier: k }),
                          });
                          session.facility = updated;
                          window.localStorage.setItem(
                            "clinicsync_session",
                            JSON.stringify({ user: session.user, facility: updated })
                          );
                          window.dispatchEvent(new Event("clinicSync:facility-updated"));
                          flash(true, `Switched to ${v.label} plan.`);
                          loadUsers();
                        } catch (e) {
                          flash(false, e.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className={`mt-3 w-full text-white text-sm font-medium py-2 rounded-lg ${
                        v.popular ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-700"
                      } disabled:opacity-50`}
                      disabled={busy}
                    >
                      {k === "BASIC" ? "Downgrade" : "Upgrade"}
                    </button>
                  )}
                  {isCurrent && (
                    <div className="mt-3 w-full text-center text-[11px] font-medium text-emerald-600 py-2 border border-emerald-300 rounded-lg">Current plan</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="bg-white rounded-xl border border-red-200">
        <div className="px-5 py-4 border-b border-red-100 flex items-center gap-2">
          <LogOut size={18} className="text-red-400" />
          <h2 className="font-semibold text-slate-900">Session</h2>
        </div>
        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600 max-w-md">
            This device stays signed in automatically. To deliberately forget this device
            (and require a PIN next time), use a <strong>hard logout</strong>.
          </p>
          <button
            onClick={async () => {
              if (!window.confirm("Forget this device? You will need the PIN to sign back in.")) return;
              await logout({ hard: true });
              window.location.href = "/login";
            }}
            className="flex items-center gap-2 border border-red-300 text-red-700 hover:bg-red-50 text-sm font-medium px-4 py-2 rounded-lg"
          >
            <LogOut size={15} /> Hard logout · forget this device
          </button>
        </div>
      </div>
    </div>
  );
}