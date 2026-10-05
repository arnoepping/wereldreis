export const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

let toastTimer;
export function toast(text) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

export const isPhone = () => innerWidth < 760;
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function readSeen() {
  try { return JSON.parse(localStorage.getItem("seen-notes") || "{}"); } catch { return {}; }
}
export function markSeen(key, count) {
  try { localStorage.setItem("seen-notes", JSON.stringify({ ...readSeen(), [key]: count })); } catch {}
}
