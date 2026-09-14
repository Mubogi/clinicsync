import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Wallet,
  ClipboardList,
  Cloud,
  LogOut,
  Menu,
  X,
  Building2,
  Users,
  BarChart3,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { initials, TIERS, cx } from "../lib/utils.js";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/pos", label: "POS", icon: ShoppingCart },
  { to: "/inventory", label: "Stock", icon: Package },
  { to: "/expenses", label: "Expenses", icon: Wallet },
  { to: "/reconciliation", label: "End of Day", icon: ClipboardList },
  { to: "/reports", label: "Reports", icon: BarChart3 },
];

export default function Layout({ children }) {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const role = session?.user?.role;
  const tier = session?.facility?.subscriptionTier || "BASIC";
  const allowUsers = session.user && session.user.id === "demo-user-owner";
  const allowReports = role === "OWNER" || role === "PHARMACIST";

  const navItems = NAV.filter((n) => {
    if (n.to === "/reports" && !allowReports) return false;
    return true;
  });

  const SidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 text-white w-64">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
        <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center font-bold text-lg">
          CS
        </div>
        <div>
          <div className="font-bold text-white leading-tight">ClinicSync</div>
          <div className="text-[11px] text-slate-400">Offline-first · JD Hub</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cx(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive ? "bg-emerald-600 text-white" : "text-slate-300 hover:bg-white/10"
              )
            }
          >
            <item.icon size={18} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-white/10 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-emerald-700 flex items-center justify-center text-xs font-bold">
            {initials(session?.user?.name)}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{session?.user?.name}</div>
            <div className="text-[11px] text-slate-400">
              {role} · <span style={{ color: TIERS[tier]?.color }}>{TIERS[tier]?.label}</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => {
            logout();
            navigate("/login");
          }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm bg-white/5 text-slate-300 hover:bg-white/10"
        >
          <LogOut size={16} /> Log out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-100">
      {/* Desktop sidebar */}
      <aside className="hidden md:block fixed inset-y-0 left-0 z-30">{SidebarContent}</aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 -right-12 w-10 h-10 rounded-full bg-white shadow flex items-center justify-center text-slate-700"
            >
              <X size={20} />
            </button>
            {SidebarContent}
          </div>
        </div>
      )}

      <div className="flex-1 md:ml-64 flex flex-col min-h-screen">
        {/* Top bar (mobile) */}
        <header className="md:hidden sticky top-0 z-40 bg-white border-b border-slate-200 flex items-center justify-between px-4 py-3">
          <button onClick={() => setMobileOpen(true)} className="p-2 -ml-2 text-slate-700">
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2 font-bold text-slate-900">
            <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-xs">CS</div>
            ClinicSync
          </div>
          <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold">
            {initials(session?.user?.name)}
          </div>
        </header>

        <main className="flex-1 pb-20 md:pb-8 px-4 md:px-6 py-5 max-w-7xl w-full mx-auto">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 flex">
          {navItems.slice(0, 5).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx(
                  "flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium",
                  isActive ? "text-emerald-600" : "text-slate-500"
                )
              }
            >
              <item.icon size={20} />
              {item.label.split(" ")[0]}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}