import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { getSession } from "./lib/api.js";
import { startSyncLoop } from "./lib/sync.js";
import "./index.css";

// Register service worker for offline PWA support, with an update flow:
// when a new build is waiting, activate it and reload once so installed users
// get the newest version without reinstalling.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        registration.update().catch(() => {});
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              installing.postMessage("SKIP_WAITING");
            }
          });
        });
      })
      .catch(() => {});

    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });
}

// Auto background sync for PREMIUM/PRO tiers
const session = getSession();
const tier = session?.facility?.subscriptionTier || "BASIC";
const stopSync = startSyncLoop({
  intervalMs: 30000,
  auto: tier === "PREMIUM" || tier === "PRO",
});
window.__clinicsync_stopSync = stopSync;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);