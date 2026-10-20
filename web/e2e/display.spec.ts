import { test, expect, type Page } from "@playwright/test";
import { translate, type Locale, type MessageKey } from "../src/i18n/index";
const label = (locale: Locale, key: MessageKey) => translate(locale, key);
async function settings(page: Page, locale: Locale = "en") {
  await page.getByRole("button", { name: label(locale, "Text size"), exact: true }).click();
  return page.getByRole("dialog", { name: label(locale, "Text size"), exact: true });
}
async function largest(page: Page, locale: Locale) {
  const dialog = await settings(page, locale);
  await dialog.getByRole("slider", { name: label(locale, "Interface text size"), exact: true }).focus(); await page.keyboard.press("End");
  await dialog.getByRole("slider", { name: label(locale, "Serial log font size"), exact: true }).focus(); await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
}
for (const locale of ["en", "zh-Hant", "zh-Hans", "es", "fr", "ar"] as const) {
  test(`${locale}: largest interface and log text across every standalone workspace`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/"); await page.locator(".language-selector select").selectOption(locale);
    await page.getByRole("button", { name: label(locale, "Connect to Hub"), exact: true }).click();
    await expect(page.locator(".lamp")).toContainText("HTTP + WS");
    await page.getByPlaceholder(label(locale, "e.g. AT or a device command")).fill("unsent-font-draft");
    let writes = 0; page.on("request", request => { if (request.url().endsWith("/v1/write")) writes++; });
    await largest(page, locale);
    expect(await page.locator("html").evaluate(node => getComputedStyle(node).fontSize)).toBe("19.2px");
    expect(await page.locator(".composer-panel textarea").first().evaluate(node => getComputedStyle(node).fontSize)).toBe("28px");
    await expect(page.locator(".composer-panel textarea").first()).toHaveValue("unsent-font-draft");
    await page.getByRole("button", { name: label(locale, "HEX bytes"), exact: true }).click();
    await expect(page.locator(".hex-send-input")).toHaveCSS("font-size", "28px");
    await expect(page.locator(".hex-send-input")).toHaveAttribute("dir", "ltr");
    await page.getByRole("button", { name: label(locale, "Text"), exact: true }).click();
    await fits(page);
    for (const key of ["Signal studio", "Events & metrics", "Connections", "User guide", "Live console"] as const) {
      await page.getByRole("navigation").getByRole("button", { name: new RegExp(label(locale, key)) }).click(); await fits(page);
    }
    expect(writes).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const dialog = await settings(page, locale); await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  });
}
test("font preferences persist, sync across tabs, reset, and survive denied storage", async ({ page, context }) => {
  await page.goto("/"); await largest(page, "en");
  await page.reload(); expect(await page.locator("html").evaluate(node => getComputedStyle(node).fontSize)).toBe("19.2px");
  const other = await context.newPage(); await other.goto("/");
  const dialog = await settings(other); await expect(dialog.getByRole("slider", { name: "Serial log font size", exact: true })).toHaveValue("28");
  await dialog.getByRole("button", { name: "Reset text size", exact: true }).click();
  await expect(page.locator("html")).toHaveCSS("font-size", "12px");
  await other.evaluate(() => localStorage.clear()); await expect(page.locator("html")).toHaveCSS("font-size", "12px");
  await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new DOMException("blocked"); }; Storage.prototype.setItem = () => { throw new DOMException("blocked"); }; });
  await page.reload(); await largest(page, "en"); await expect(page.locator("html")).toHaveCSS("font-size", "19.2px");
});

test.describe("manager and tiled terminals", () => {
  test.use({ baseURL: "http://127.0.0.1:18889", viewport: { width: 1366, height: 768 } });
  test("all six languages retain live multi-port interaction at maximum text sizes", async ({ page, request }) => {
    const existing = await (await request.get("/manager/info")).json();
    for (const session of existing.sessions) await request.delete(`/manager/sessions/${session.id}`);
    const devices: { id: string; path: string }[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        const path = `mock:font-${i}`;
        const response = await request.post("/manager/sessions", { data: { path, name: `Font device ${i}`, settings: { baud: 115200, databits: 8, parity: "none", stopbits: 1, flow: "none" } } });
        expect(response.ok()).toBe(true); devices.push({ ...(await response.json()), path });
      }
      await page.goto("/"); await largest(page, "en"); await fits(page);
      await page.getByRole("tab", { name: "Multi-port workspace", exact: true }).click();
      await expect(page.locator(".port-state")).toHaveText(["Receiving", "Receiving", "Receiving"]);
      await fits(page);
      for (const locale of ["en", "zh-Hant", "zh-Hans", "es", "fr", "ar"] as const) {
        await page.locator(".language-selector:visible select").selectOption(locale);
        await fits(page);
        const dialog = await settings(page, locale);
        await expect(dialog.getByRole("slider", { name: label(locale, "Serial log font size"), exact: true })).toHaveValue("28");
        await page.keyboard.press("Escape");
        for (const panel of await page.locator(".port-panel:visible").all()) {
          expect(await panel.locator(".port-log").evaluate(node => node.clientHeight)).toBeGreaterThan(40);
          expect(await panel.locator("textarea").evaluate(node => getComputedStyle(node).fontSize)).toBe("28px");
          await expect(panel.locator("textarea")).toHaveAttribute("dir", "auto");
        }
      }
      const response = await request.post(`/sessions/${devices[0].id}/v1/write`, { data: { text: "large-font-温度-العربية" } }); expect(response.ok()).toBe(true);
      await expect(page.locator(`[data-device="${devices[0].path}"] .port-entry.rx pre`)).toContainText(["large-font-温度-العربية"]);
      expect(await page.locator(`[data-device="${devices[0].path}"] .port-entry.rx`).first().evaluate(node => getComputedStyle(node).fontSize)).toBe("28px");
      await expect(page.locator(`[data-device="${devices[1].path}"] .port-entry.rx`)).toHaveCount(0);
      const first = page.locator(`[data-device="${devices[0].path}"]`);
      await expect(first.locator(".port-entry.rx").first()).toHaveCSS("direction", "ltr");
      await first.getByRole("button", { name: "HEX", exact: true }).click();
      await expect(first.locator("textarea")).toHaveAttribute("dir", "ltr");
      await first.locator("textarea").fill("00 01 FF");
      await expect(first.locator("textarea")).toHaveValue("00 01 FF");
      await page.locator(".language-selector:visible select").selectOption("en");
      await page.getByRole("button", { name: /^Manage devices/ }).click();
      await page.locator(".manager-session").first().getByRole("button", { name: /Open workspace/ }).click();
      await expect(page.locator(".managed-workspace:visible .lamp")).toContainText("HTTP + WS"); await fits(page);
      await settings(page); await page.keyboard.press("Escape");
    } finally { for (const device of devices) await request.delete(`/manager/sessions/${device.id}`); }
  });
});
