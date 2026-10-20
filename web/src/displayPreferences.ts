export const DISPLAY_STORAGE_KEY = "serialhub.ui.display.v1";
export type DisplayPreferences = Readonly<{ uiScale: number; logSize: number }>;
export const DEFAULT_DISPLAY: DisplayPreferences = Object.freeze({ uiScale: 100, logSize: 12 });
export function parseDisplayPreferences(value: unknown): DisplayPreferences {
  if (!value || typeof value !== "object") return DEFAULT_DISPLAY;
  const input = value as Record<string, unknown>;
  const valid = (n: unknown, min: number, max: number, step: number, fallback: number) =>
    typeof n === "number" && Number.isFinite(n) && n >= min && n <= max && n % step === 0 ? n : fallback;
  return { uiScale: valid(input.uiScale, 80, 160, 10, 100), logSize: valid(input.logSize, 10, 28, 1, 12) };
}
let current: DisplayPreferences = DEFAULT_DISPLAY;
const listeners = new Set<() => void>();
export const getDisplayPreferences = () => current;
export const subscribeDisplay = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setDisplayPreferences(value: DisplayPreferences, persist = true) {
  const next = parseDisplayPreferences(value);
  if (persist) {
    try { window.localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(next)); } catch { /* Session-only preferences still work. */ }
  }
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--ui-font-scale", String(next.uiScale / 100));
    document.documentElement.style.setProperty("--log-font-size", `${next.logSize}px`);
    document.documentElement.dataset.largeText = String(next.uiScale > 100);
  }
  if (current.uiScale === next.uiScale && current.logSize === next.logSize) return;
  current = next;
  listeners.forEach(listener => listener());
}
export function initializeDisplay() {
  let value: unknown;
  try { value = JSON.parse(window.localStorage.getItem(DISPLAY_STORAGE_KEY) ?? "null"); } catch { /* Invalid or blocked storage uses defaults. */ }
  setDisplayPreferences(parseDisplayPreferences(value), false);
}
export function syncDisplayStorage(event: StorageEvent) {
  try {
    if (event.storageArea === window.localStorage && (event.key === DISPLAY_STORAGE_KEY || event.key === null)) initializeDisplay();
  } catch { /* Storage can become unavailable after initialization. */ }
}
