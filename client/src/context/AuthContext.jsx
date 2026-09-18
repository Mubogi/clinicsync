import { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  getSession,
  setSession,
  apiFetch,
  login as apiLogin,
  loginWithPassword as apiLoginWithPassword,
  signupClinic as apiSignupClinic,
  logout as apiLogout,
  applyLoginResponse,
  tryRememberLogin,
} from "../lib/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSessionState] = useState(getSession());
  const [ready, setReady] = useState(getSession() ? true : false);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      let current = getSession();
      // If we have a session token, validate against server
      if (current && current.user) {
        try {
          const d = await apiFetch("/auth/me");
          if (cancelled) return;
          current = {
            user: d.user,
            facility: d.facility,
          };
          setSession(current);
        } catch {
          // offline or expired — try remember-me, else fall back to cached
          const d = await tryRememberLogin().catch(() => null);
          if (cancelled) return;
          if (d) {
            current = {
              user: d.user,
              facility: d.facility,
            };
            setSession(current);
          }
        }
      } else {
        // no cached session — attempt persistent remember-me auto-login
        const d = await tryRememberLogin().catch(() => null);
        if (cancelled) return;
        if (d) {
          current = { user: d.user, facility: d.facility };
          setSession(current);
        } else {
          current = null;
        }
      }
      if (!cancelled) {
        setReady(true);
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (facilityName, pinCode, remember = true) => {
    const data = await apiLogin(facilityName, pinCode, remember);
    setSessionState({
      user: data.user,
      facility: data.facility,
    });
    return data;
  }, []);

  const loginPassword = useCallback(async (username, password, remember = false) => {
    const data = await apiLoginWithPassword(username, password, remember);
    setSessionState({ user: data.user, facility: data.facility });
    return data;
  }, []);

  const signup = useCallback(async (payload) => {
    const data = await apiSignupClinic(payload);
    setSessionState({ user: data.user, facility: data.facility });
    return data;
  }, []);

  // `hard` = revoke remember-me and clear device (deliberate, hard logout)
  const logout = useCallback(async ({ hard = false } = {}) => {
    await apiLogout({ hard });
    setSessionState(null);
  }, []);

  const refreshSession = useCallback((data) => {
    applyLoginResponse(data);
    setSessionState({
      user: data.user,
      facility: data.facility,
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{ session, setSession: setSessionState, login, loginPassword, signup, logout, refreshSession, ready }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}