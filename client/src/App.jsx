import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";

import Login from "./pages/Login.jsx";
import Landing from "./pages/Landing.jsx";
import Signup from "./pages/Signup.jsx";
import Billing from "./pages/Billing.jsx";
import JoinPage from "./pages/JoinPage.jsx";
import Setup from "./pages/Setup.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Pos from "./pages/Pos.jsx";
import Inventory from "./pages/Inventory.jsx";
import Expenses from "./pages/Expenses.jsx";
import Reconciliation from "./pages/Reconciliation.jsx";
import Reports from "./pages/Reports.jsx";
import Settings from "./pages/Settings.jsx";
import Admin from "./pages/Admin.jsx";
import Layout from "./components/Layout.jsx";

function Protected({ children }) {
  const { session, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>;
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
  // New facilities that haven't completed first-time setup go to /setup first
  if (session.facility && session.facility.onboarded === false) {
    return <Navigate to="/setup" replace />;
  }
  return <Layout>{children}</Layout>;
}

// Setup is a full-screen wizard rendered without the clinic <Layout>. It must
// NOT use `Protected`: Protected sends un-onboarded facilities to /setup, which
// on this route would redirect to itself and blank the page.
function SetupRoute() {
  const { session, ready } = useAuth();
  if (!ready) return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (session.facility && session.facility.onboarded) return <Navigate to="/dashboard" replace />;
  return <Setup />;
}

// Operator console: deliberately rendered outside the clinic <Layout> because
// it manages many clinics, not the signed-in user's own. Access is enforced by
// the server (SYS_ADMIN_IDS); the page itself just renders a notice on 403.
function AdminRoute() {
  const { session, ready } = useAuth();
  if (!ready) return <div className="min-h-screen flex items-center justify-center text-slate-500">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <Admin />;
}

export default function App() {
  return (
    <Routes>
      {/* Public: marketing, pricing and self-service signup. The landing page
          bounces signed-in users to their dashboard rather than showing a pitch. */}
      <Route path="/" element={<Landing />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/login" element={<Login />} />
      <Route path="/join" element={<JoinPage />} />
      <Route path="/setup" element={<SetupRoute />} />
      <Route
        path="/dashboard"
        element={
          <Protected>
            <Dashboard />
          </Protected>
        }
      />
      <Route
        path="/billing"
        element={
          <Protected>
            <Billing />
          </Protected>
        }
      />
      <Route
        path="/pos"
        element={
          <Protected>
            <Pos />
          </Protected>
        }
      />
      <Route
        path="/inventory"
        element={
          <Protected>
            <Inventory />
          </Protected>
        }
      />
      <Route
        path="/expenses"
        element={
          <Protected>
            <Expenses />
          </Protected>
        }
      />
      <Route
        path="/reconciliation"
        element={
          <Protected>
            <Reconciliation />
          </Protected>
        }
      />
      <Route
        path="/reports"
        element={
          <Protected>
            <Reports />
          </Protected>
        }
      />
      <Route
        path="/settings"
        element={
          <Protected>
            <Settings />
          </Protected>
        }
      />
      <Route path="/admin" element={<AdminRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}