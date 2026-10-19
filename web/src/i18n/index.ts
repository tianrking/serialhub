import en from "./locales/en.ts";
import zhHant from "./locales/zh-Hant.ts";
import zhHans from "./locales/zh-Hans.ts";
import es from "./locales/es.ts";
import fr from "./locales/fr.ts";
import ar from "./locales/ar.ts";

export type MessageKey = keyof typeof en;
export type Catalog = Record<MessageKey, string>;
export const CATALOGS = { en, "zh-Hant": zhHant, es, fr, ar, "zh-Hans": zhHans } satisfies Record<string, Catalog>;
export type Locale = keyof typeof CATALOGS;
export const LOCALES: ReadonlyArray<{ id: Locale; name: string; direction: "ltr" | "rtl" }> = [
  { id: "en", name: "English", direction: "ltr" },
  { id: "zh-Hant", name: "繁體中文", direction: "ltr" },
  { id: "es", name: "Español", direction: "ltr" },
  { id: "fr", name: "Français", direction: "ltr" },
  { id: "ar", name: "العربية", direction: "rtl" },
  { id: "zh-Hans", name: "简体中文", direction: "ltr" },
];
export const LOCALE_STORAGE_KEY = "serialhub.ui.locale.v1";
const aliases: Record<string, Locale> = { en: "en", "en-us": "en", "en-gb": "en", "zh-hant": "zh-Hant", "zh-tw": "zh-Hant", "zh-hk": "zh-Hant", "zh-hans": "zh-Hans", "zh-cn": "zh-Hans", es: "es", fr: "fr", ar: "ar" };
export function normalizeLocale(value: unknown): Locale | undefined {
  if (typeof value !== "string") return undefined;
  const tag = value.trim().replaceAll("_", "-").toLowerCase();
  if (Object.hasOwn(aliases, tag)) return aliases[tag];
  const language = tag.split("-")[0]!;
  return ["en", "es", "fr", "ar"].includes(language) ? language as Locale : undefined;
}

export type LocalePolicy = { defaultLocale: Locale; enabledLocales: readonly Locale[] };
export function resolveLocalePolicy(defaultLocale?: string, enabledLocales?: string): LocalePolicy {
  const supported = enabledLocales?.split(",").flatMap(value => { const locale = normalizeLocale(value); return locale ? [locale] : []; });
  const enabled = supported?.length ? [...new Set(supported)] : enabledLocales?.trim() ? ["en" as Locale] : LOCALES.map(locale => locale.id);
  const preferred = normalizeLocale(defaultLocale) ?? "en";
  return { enabledLocales: enabled, defaultLocale: enabled.includes(preferred) ? preferred : enabled[0]! };
}

let policy = resolveLocalePolicy();
let current: Locale = "en";
const listeners = new Set<() => void>();
export const getLocale = () => current;
// Specify the numbering system so differing CLDR versions agree on Arabic digits.
export const getFormattingLocale = () => current === "ar" ? "ar-u-nu-arab" : current;
export const getLocalePolicy = () => policy;
export const subscribeLocale = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function interpolate(message: string, params: Readonly<Record<string, string | number>> = {}): string {
  // A replacement callback treats '$&' and '$`' in device/user values literally.
  return message.replace(/\{(p\d+|\w+)\}/g, (token, name: string) => Object.hasOwn(params, name) ? String(params[name]) : token);
}
export function translate(locale: Locale, key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  return interpolate(CATALOGS[locale][key] || en[key], params);
}
export const t = (key: MessageKey, params?: Readonly<Record<string, string | number>>) => translate(current, key, params);
const staticMessages = new Map<string, MessageKey>();
for (const catalog of Object.values(CATALOGS)) for (const [key, value] of Object.entries(catalog)) {
  if (!/\{\w+\}/.test(key)) staticMessages.set(value, key as MessageKey);
}
/** Only for internal UI status fields. Never pass RX, TX or imported user data. */
export function localizeStatus(value: string, locale: Locale = current): string {
  const key = staticMessages.get(value);
  return key ? translate(locale, key) : value;
}
const numberFormats = new Map<string, Intl.NumberFormat>();
export function number(value: number, options?: Intl.NumberFormatOptions): string {
  const key = current + JSON.stringify(options ?? {});
  let formatter = numberFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(getFormattingLocale(), options);
    if (numberFormats.size >= 64) numberFormats.clear();
    numberFormats.set(key, formatter);
  }
  return formatter.format(value);
}
export function dateTime(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(getFormattingLocale(), { hour12: false, ...options }).format(value);
}

function updateDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = current;
  document.documentElement.dir = current === "ar" ? "rtl" : "ltr";
  document.title = t("SerialHub console");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("Reliable device sharing, live data and operation records"));
}
export function setLocale(requested: string, persist = true): boolean {
  const locale = normalizeLocale(requested);
  if (!locale || !policy.enabledLocales.includes(locale)) return false;
  if (persist && typeof window !== "undefined") {
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* Private storage must not prevent switching. */ }
  }
  if (current !== locale) {
    current = locale;
    updateDocument();
    for (const listener of listeners) listener();
  } else updateDocument();
  return true;
}
export function initializeI18n(options: { defaultLocale?: string; enabledLocales?: string } = {}) {
  policy = resolveLocalePolicy(options.defaultLocale, options.enabledLocales);
  let saved: string | null = null;
  if (typeof window !== "undefined") {
    try { saved = window.localStorage.getItem(LOCALE_STORAGE_KEY); } catch { /* Use the configured default. */ }
  }
  const preferred = normalizeLocale(saved);
  setLocale(preferred && policy.enabledLocales.includes(preferred) ? preferred : policy.defaultLocale, false);
}
export function syncLocaleStorage(event: Pick<StorageEvent, "key" | "newValue">) {
  if (event.key !== LOCALE_STORAGE_KEY && event.key !== null) return;
  const requested = normalizeLocale(event.newValue);
  setLocale(requested && policy.enabledLocales.includes(requested) ? requested : policy.defaultLocale, false);
}
