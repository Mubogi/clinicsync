import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getSession, setSession, apiFetch, login as apiLogin, logout as apiLogout } from "../lib/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSessionState] = useState(getSession());
  const [ready, setReady] = useState(true);

  useEffect(() => {
    if (!session) return;
    // Validate stored session against server (best-effort)
    apiFetch("/auth/me")
      .then((d) => {
        setSessionState({
          user: d.user,
          facility: d.facility,
        });
        setSession({
          user: d.user,
          facility: d.facility,
        });
      })
      .catch(() => {
        // offline or invalid — keep cached session for offline-first usage
      })
      .finally(() => setReady(true));
  }, [session?.user?.id]);

  const login = useCallback(async (facilityName, pinCode) => {
    const data = await apiLogin(facilityName, pinCode);
    setSessionState(data);
    return data;
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setSessionState(null);
  }, []);

  return (
    <AuthContext.Provider value={{ session, setSession: setSessionState, login, logout, ready }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}