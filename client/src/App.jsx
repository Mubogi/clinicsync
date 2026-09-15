import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";

import Login from "./pages/Login.jsx";
import JoinPage from "./pages/JoinPage.jsx";
import Setup from "./pages/Setup.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Pos from "./pages/Pos.jsx";
import Inventory from "./pages/Inventory.jsx";
import Expenses from "./pages/Expenses.jsx";
import Reconciliation from "./pages/Reconciliation.jsx";
import Reports from "./pages/Reports.jsx";
import Settings from "./pages/Settings.jsx";
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

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/join" element={<JoinPage />} />
      <Route
        path="/setup"
        element={
          <Protected>
            <Setup />
          </Protected>
        }
      />
      <Route
        path="/"
        element={
          <Protected>
            <Dashboard />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}