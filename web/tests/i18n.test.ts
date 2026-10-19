import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { CATALOGS, LOCALES, LOCALE_STORAGE_KEY, getLocale, getLocalePolicy, initializeI18n, interpolate, localizeStatus, normalizeLocale, number, resolveLocalePolicy, setLocale, subscribeLocale, syncLocaleStorage, t, translate } from "../src/i18n/index.ts";
import { commandBytes, workspaceBackup } from "../src/serialTools.ts";
import { exportCsv } from "../src/signals/files.ts";
import { defaultChannel } from "../src/signals/math.ts";

beforeEach(() => initializeI18n());

test("English is the deterministic default and supported aliases are normalized", () => {
  assert.equal(getLocale(), "en");
  assert.equal(t("Connect to Hub"), "Connect to Hub");
  assert.equal(normalizeLocale("zh_TW"), "zh-Hant");
  assert.equal(normalizeLocale("zh-HK"), "zh-Hant");
  assert.equal(normalizeLocale("zh_CN"), "zh-Hans");
  assert.equal(normalizeLocale("es-MX"), "es");
  assert.equal(normalizeLocale("ar-EG"), "ar");
  for (const value of ["__proto__", "constructor", "toString", "de", "zh", "<script>", null, {}]) assert.equal(normalizeLocale(value), undefined);
});

test("catalogs have identical complete keys and retain every interpolation token", () => {
  const keys = Object.keys(CATALOGS.en).sort();
  assert.ok(keys.length > 650);
  const variables = (value: string) => [...value.matchAll(/\{\w+\}/g)].map(match => match[0]).sort();
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    assert.deepEqual(Object.keys(catalog).sort(), keys, locale);
    for (const [key, value] of Object.entries(catalog)) {
      assert.ok(value.trim(), `${locale}: ${key}`);
      assert.deepEqual(variables(value), variables(key), `${locale}: ${key}`);
    }
  }
  assert.equal(translate("zh-Hant", "Device settings"), "裝置參數");
  assert.equal(translate("es", "Connect to Hub"), "Conectar al Hub");
  assert.equal(translate("fr", "Disconnect"), "Déconnecter");
  assert.equal(translate("ar", "Interface language"), "لغة الواجهة");
});

test("deployment policy limits selectable locales, ignores stale preferences and remains deterministic", () => {
  assert.deepEqual(resolveLocalePolicy("ar", "fr, ar, fr, unsupported"), { defaultLocale: "ar", enabledLocales: ["fr", "ar"] });
  assert.deepEqual(resolveLocalePolicy("es", "fr,ar"), { defaultLocale: "fr", enabledLocales: ["fr", "ar"] });
  assert.deepEqual(resolveLocalePolicy("ar", "unsupported"), { defaultLocale: "en", enabledLocales: ["en"] });
  initializeI18n({ defaultLocale: "fr", enabledLocales: "en,fr" });
  assert.equal(getLocale(), "fr");
  assert.equal(setLocale("ar"), false);
  assert.equal(getLocale(), "fr");
  assert.equal(setLocale("en"), true);
  syncLocaleStorage({ key: LOCALE_STORAGE_KEY, newValue: "ar" });
  assert.equal(getLocale(), "fr");
  syncLocaleStorage({ key: "unrelated", newValue: "en" });
  assert.equal(getLocale(), "fr");
  assert.deepEqual(getLocalePolicy().enabledLocales, ["en", "fr"]);
});

test("language changes notify once and storage resets use the configured default", () => {
  let changes = 0;
  const unsubscribe = subscribeLocale(() => changes++);
  assert.equal(setLocale("es"), true);
  assert.equal(setLocale("es"), true);
  assert.equal(setLocale("unknown"), false);
  assert.equal(changes, 1);
  syncLocaleStorage({ key: LOCALE_STORAGE_KEY, newValue: "zh-TW" });
  assert.equal(getLocale(), "zh-Hant");
  syncLocaleStorage({ key: null, newValue: null });
  assert.equal(getLocale(), "en");
  assert.equal(changes, 3);
  unsubscribe(); setLocale("fr"); assert.equal(changes, 3);
});

test("interpolation preserves literal user values and never treats them as replacement syntax or markup", () => {
  const payload = '$& $` {p1} <img onerror=alert(1)> 温度';
  assert.equal(interpolate("Name: {p0}; {p0}", { p0: payload }), `Name: ${payload}; ${payload}`);
  assert.equal(translate("fr", "Copied: {p0}", { p0: payload }), `Copié : ${payload}`);
  assert.equal(interpolate("{value}"), "{value}");
});

test("display numbers and internal status follow the locale without translating arbitrary data", () => {
  setLocale("fr");
  assert.match(number(1234.5), /1\s234,5/);
  assert.equal(localizeStatus("等待数据"), "En attente de données");
  assert.equal(localizeStatus("DEV:raw,<p0>,温度"), "DEV:raw,<p0>,温度");
  setLocale("ar");
  assert.match(number(1234.5), /١.*٢٣٤.*٥/);
});

test("language selection never changes command bytes, CSV decimals, configuration or user labels", () => {
  const command = { id: "original", name: "温度 العربية", mode: "text" as const, payload: "SET:1.25,温度", lineEnding: "crlf" as const };
  const samples = [{ index: 0, receivedAt: 1000, values: [1.25] }, { index: 1, receivedAt: 1001, values: [-2.5] }];
  const channels = [defaultChannel(0)];
  const expectedBytes = new TextEncoder().encode("SET:1.25,温度\r\n");
  const originalCsv = exportCsv(samples, channels, 1000), originalSettings = workspaceBackup([command], []);
  for (const { id } of LOCALES) {
    setLocale(id);
    assert.deepEqual(commandBytes(command, "utf-8"), expectedBytes, id);
    assert.equal(exportCsv(samples, channels, 1000), originalCsv, id);
    assert.equal(workspaceBackup([command], []), originalSettings, id);
    assert.equal(command.name, "温度 العربية");
  }
});
