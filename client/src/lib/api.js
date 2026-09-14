const TOKEN_KEY = "clinicsync_token";
const REMEMBER_KEY = "clinicsync_remember_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

// Persistent "remember me" token — lets the app auto-login across restarts
export function getRememberToken() {
  return localStorage.getItem(REMEMBER_KEY);
}

export function setRememberToken(token) {
  if (token) localStorage.setItem(REMEMBER_KEY, token);
  else localStorage.removeItem(REMEMBER_KEY);
}

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem("clinicsync_session") || "null");
  } catch {
    return null;
  }
}

export function setSession(session) {
  if (session) localStorage.setItem("clinicsync_session", JSON.stringify(session));
  else localStorage.removeItem("clinicsync_session");
}

export function apiFetch(path, options = {}) {
  const opts = { ...options };
  const token = getToken();
  opts.headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {}),
  };
  return fetch(`/api${path}`, opts).then(async (res) => {
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      throw new Error((data && data.error) || `Request failed (${res.status})`);
    }
    return data;
  });
}

export async function login(facilityName, pinCode, remember = true) {
  const data = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ facilityName, pinCode, remember }),
  });
  applyLoginResponse(data);
  return data;
}

// Persist the tokens + session returned by the server (login or remember)
export function applyLoginResponse(data) {
  setToken(data.token);
  if (data.rememberToken) {
    setRememberToken(data.rememberToken);
  } else if (localStorage.getItem(REMEMBER_KEY)) {
    // keep existing remember token (silent relogin flow doesn't re-mint)
  }
  setSession({
    user: data.user,
    facility: data.facility,
  });
}

// Try to auto-login via the persistent remember-me token (no PIN needed)
export async function tryRememberLogin() {
  const rt = getRememberToken();
  if (!rt) return null;
  try {
    const data = await apiFetch("/auth/remember", {
      method: "POST",
      body: JSON.stringify({ rememberToken: rt }),
    });
    applyLoginResponse(data);
    return data;
  } catch {
    return null;
  }
}

// Hard logout: revoke the remember-me token server-side so the device is forgotten
export async function logout({ hard = false } = {}) {
  if (hard) {
    try {
      const rt = getRememberToken();
      await apiFetch("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ revokeRemember: true, rememberToken: rt }),
      });
    } catch {
      // offline — clear locally regardless
    }
  }
  setToken(null);
  setSession(null);
  setRememberToken(null);
}