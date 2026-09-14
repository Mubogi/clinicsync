export const fmtMoney = (n) => {
  const num = Number(n || 0);
  return "UGX " + num.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

export const fmtShortMoney = (n) => {
  const num = Number(n || 0);
  return num.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

export const fmtDate = (iso) => {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(iso);
  }
};

export const fmtTime = (iso) => {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
};

export const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const initials = (name) =>
  (name || "?")
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export const TIERS = {
  BASIC: { label: "Basic", color: "#64748b" },
  PREMIUM: { label: "Premium", color: "#f59e0b" },
  PRO: { label: "Pro", color: "#059669" },
};