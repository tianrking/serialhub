import { test, expect, type Page } from "@playwright/test";
import { translate, type Locale, type MessageKey } from "../src/i18n/index";

test.use({ locale: "zh-TW" }); // Product default stays English regardless of browser preferences.

const picker = (page: Page) => page.locator(".language-selector select");
const label = (locale: Locale, key: MessageKey) => translate(locale, key);
async function fits(page: Page) {
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
  expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
  expect(size.scrollHeight).toBeLessThanOrEqual(size.height);
  const nav = await page.getByRole("navigation").boundingBox(), status = await page.locator(".header-status").boundingBox();
  expect(nav && status).toBeTruthy();
  expect(nav!.x + nav!.width <= status!.x + 1 || status!.x + status!.width <= nav!.x + 1).toBe(true);
}

for (const locale of ["en", "zh-Hant", "es", "fr", "ar"] as const) {
  test(`${locale}: local controls, real UTF-8 writes and single-screen layout`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    await expect(picker(page)).toHaveValue("en");
    await picker(page).selectOption(locale);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    await expect(page).toHaveTitle(label(locale, "SerialHub console"));
    await fits(page);
    await page.getByRole("button", { name: label(locale, "Connect to Hub"), exact: true }).click();
    await expect(page.getByRole("status").first()).toContainText("HTTP + WS");
    const marker = `payload-${locale}-温度-العربية-${Date.now()}`;
    await page.getByPlaceholder(label(locale, "e.g. AT or a device command")).fill(marker);
    await page.getByRole("button", { name: label(locale, "Send text"), exact: true }).click();
    await expect(page.locator(".line.rx .msg").filter({ hasText: marker })).toBeVisible();
    await page.getByRole("tab", { name: label(locale, "Toolkit"), exact: true }).click();
    await expect(page.getByRole("button", { name: label(locale, "Send file"), exact: true })).toBeVisible();
    await page.getByRole("tab", { name: label(locale, "Device settings"), exact: true }).click();
    await page.getByRole("navigation").getByRole("button", { name: new RegExp(label(locale, "Signal studio")) }).click();
    await expect(page.getByRole("button", { name: label(locale, "Channels & frames"), exact: true })).toBeVisible();
    await page.getByLabel(label(locale, "Signal parser protocol"), { exact: true }).selectOption("firewater");
    await page.getByLabel(label(locale, "Device sample rate"), { exact: true }).fill("1024");
    const text = Array.from({ length: 1024 }, (_, i) => `${Math.sin(i * Math.PI / 8).toFixed(5)},${Math.cos(i * Math.PI / 8).toFixed(5)}\n`).join("");
    const response = await page.request.post("/v1/write", { data: { text, newline: false } });
    expect((await response.json()).ok).toBe(true);
    await expect(page.getByTestId("spectrum-peak")).toContainText(locale === "ar" ? "٦٤ Hz" : "64 Hz");
    await fits(page);
    const path = await page.locator(".signal-scope path[data-channel='0']").getAttribute("d");
    expect(path).toMatch(/^[ML0-9.,\s-]+$/);
    await page.getByRole("button", { name: label(locale, "Channels & frames"), exact: true }).click();
    await expect(page.getByRole("dialog", { name: label(locale, "Channels & frames"), exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: label(locale, "Apply frame settings"), exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("language preference persists, synchronizes across tabs, and does not reconnect or duplicate a pending write", async ({ page, context }) => {
  let health = 0, writes = 0;
  page.on("request", request => { if (request.url().endsWith("/v1/health")) health++; });
  await page.goto("/");
  await page.getByRole("button", { name: "Connect to Hub", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("HTTP + WS");
  let release = () => {}, started = () => {};
  const held = new Promise<void>(resolve => { release = resolve; }), pending = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/v1/write", async route => {
    writes++; const response = await route.fetch(); started(); await held; await route.fulfill({ response });
  });
  const marker = `unchanged-UTF8-温度-${Date.now()}`;
  await page.getByPlaceholder("e.g. AT or a device command").fill(marker);
  await page.getByRole("button", { name: "Send text", exact: true }).click();
  await pending;
  await picker(page).selectOption("ar");
  await expect(page.locator(".composer-panel .send-button:visible")).toBeDisabled();
  await expect(page.locator(".composer-panel textarea").first()).toHaveValue(marker);
  release();
  await expect(page.locator(".line.tx").filter({ hasText: marker })).toBeVisible();
  expect(writes).toBe(1); expect(health).toBe(1);
  const second = await context.newPage(); await second.goto("/");
  await expect(picker(second)).toHaveValue("ar");
  await picker(second).selectOption("fr");
  await expect(picker(page)).toHaveValue("fr");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator(".composer-panel textarea").first()).toHaveValue(marker);
  await second.reload(); await expect(picker(second)).toHaveValue("fr");
  await page.getByRole("button", { name: label("fr", "Disconnect"), exact: true }).click();
  await page.unrouteAll({ behavior: "wait" });
});

test("a locale change cannot enable malformed Hex or rewrite user command contents", async ({ page }) => {
  let writes = 0; page.on("request", request => { if (request.url().endsWith("/v1/write")) writes++; });
  await page.goto("/"); await page.getByRole("button", { name: "Connect to Hub", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("HTTP + WS");
  await page.getByRole("button", { name: "HEX bytes", exact: true }).click();
  const input = page.getByPlaceholder("41 54 0d 0a"); await input.fill("GG");
  for (const locale of ["en", "zh-Hant", "es", "fr", "ar"] as const) {
    await picker(page).selectOption(locale);
    await expect(page.getByRole("button", { name: label(locale, "Send Hex"), exact: true })).toBeDisabled();
    await expect(input).toHaveValue("GG");
    await expect(page.locator(".composer-panel .inline-hint.error")).toContainText(label(locale, "Error"));
  }
  expect(writes).toBe(0);
});

test("storage denial does not prevent selecting a language", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("blocked", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("blocked", "SecurityError"); };
  });
  await page.goto("/"); await expect(picker(page)).toHaveValue("en");
  await picker(page).selectOption("es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("button", { name: "Conectar al Hub", exact: true })).toBeVisible();
  await page.reload(); await expect(picker(page)).toHaveValue("en");
});
