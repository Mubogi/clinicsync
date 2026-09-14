const TOKEN_KEY = "clinicsync_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
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

export async function login(facilityName, pinCode) {
  const data = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ facilityName, pinCode }),
  });
  setToken(data.token);
  setSession({
    user: data.user,
    facility: data.facility,
  });
  return data;
}

export function logout() {
  setToken(null);
  setSession(null);
}