import { test, expect, type Page } from "@playwright/test";

// Keep established wire/safety fixtures stable; i18n.spec.ts tests the English default.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("serialhub.ui.locale.v1", "zh-Hans"));
});

async function connect(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "连接 Hub", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("HTTP + WS");
}

async function windowFits(page: Page, selectors: string[]) {
  const result = await page.evaluate(selectors => ({
    width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
    scrollTop: document.scrollingElement!.scrollTop,
    panes: selectors.map(selector => {
      const element = document.querySelector(selector)!;
      const rect = element.getBoundingClientRect();
      return { selector, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    }),
  }), selectors);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.width);
  expect(result.scrollHeight).toBeLessThanOrEqual(result.height);
  expect(result.scrollTop).toBe(0);
  for (const pane of result.panes) {
    expect(pane.x, pane.selector).toBeGreaterThanOrEqual(0);
    expect(pane.y, pane.selector).toBeGreaterThanOrEqual(0);
    expect(pane.right, pane.selector).toBeLessThanOrEqual(result.width);
    expect(pane.bottom, pane.selector).toBeLessThanOrEqual(result.height);
    expect(pane.width, pane.selector).toBeGreaterThan(100);
    expect(pane.height, pane.selector).toBeGreaterThan(90);
  }
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`terminal and signal panes fit a ${viewport.width}x${viewport.height} desktop without page scrolling`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await connect(page);
    await windowFits(page, [".log-panel", ".composer-panel", ".waveform-panel", ".workbench-dock"]);
    await page.getByPlaceholder("例如 AT 或任意指令").fill("single-screen-check");
    await page.getByRole("button", { name: "发送文本", exact: true }).click();
    await expect(page.locator(".line.rx").filter({ hasText: "single-screen-check" })).toBeVisible();
    await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: /信号仪表/ }).click();
    await page.getByLabel("信号解析协议", { exact: true }).selectOption("firewater");
    await page.getByLabel("设备采样率", { exact: true }).fill("1024");
    const text = Array.from({ length: 1024 }, (_, i) => `${Math.sin(i * Math.PI / 8).toFixed(5)},${Math.cos(i * Math.PI / 8).toFixed(5)}\n`).join("");
    const response = await page.request.post("/v1/write", { data: { text, newline: false } });
    expect((await response.json()).ok).toBe(true);
    await expect(page.getByTestId("spectrum-peak")).toContainText("64 Hz");
    await windowFits(page, [".scope-card", ".signal-meters", ".signal-instrument-grid"]);
    await page.getByRole("tab", { name: "XY", exact: true }).click();
    await expect(page.getByRole("img", { name: "XY 轨迹图", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "FFT 单边幅度谱", exact: true })).toBeHidden();
    await page.getByRole("tab", { name: "瀑布", exact: true }).click();
    await expect(page.getByRole("img", { name: "频谱瀑布图，最新窗口在顶部", exact: true })).toBeVisible();
    await windowFits(page, [".scope-card", ".signal-instrument-grid"]);
  });
}

test("tool tabs keep drafts and file selection while the composer and terminal remain available", async ({ page }) => {
  await connect(page);
  let writes = 0;
  page.on("request", request => { if (request.url().endsWith("/v1/write")) writes++; });
  const draft = page.getByPlaceholder("例如 AT 或任意指令");
  await draft.fill("unsent-device-command");
  await page.getByRole("tab", { name: "快捷指令", exact: true }).click();
  await page.locator(".quick-panel").getByLabel("名称", { exact: true }).fill("unfinished shortcut");
  await page.getByRole("tab", { name: "快捷指令", exact: true }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: "工具箱", exact: true })).toBeFocused();
  await page.getByLabel("选择发送文件", { exact: true }).setInputFiles({ name: "draft.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0, 255]) });
  await page.getByRole("tab", { name: "设备参数", exact: true }).click();
  await page.getByRole("tab", { name: "工具箱", exact: true }).click();
  await expect(page.locator(".file-info")).toContainText("draft.bin");
  await page.getByRole("tab", { name: "快捷指令", exact: true }).click();
  await expect(page.locator(".quick-panel").getByLabel("名称", { exact: true })).toHaveValue("unfinished shortcut");
  await expect(draft).toHaveValue("unsent-device-command");
  await expect(page.getByRole("button", { name: "发送文本", exact: true })).toBeVisible();
  expect(writes).toBe(0);
});

test("configuration dialogs contain focus, close with Escape, and leave measurement interactions usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: /信号仪表/ }).click();
  const configure = page.getByRole("button", { name: "通道与数据帧配置", exact: true });
  await configure.click();
  const dialog = page.getByRole("dialog", { name: "通道与数据帧配置", exact: true });
  await expect(dialog).toBeVisible();
  await page.getByLabel("CH0 名称", { exact: true }).fill("Temperature");
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(configure).toBeFocused();
  await configure.click();
  await expect(page.getByLabel("CH0 名称", { exact: true })).toHaveValue("Temperature");
  await page.getByRole("button", { name: "关闭通道与数据帧配置", exact: true }).click();
  await page.getByRole("button", { name: "原始数据表", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "原始数据表", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await windowFits(page, [".scope-card", ".signal-meters", ".signal-instrument-grid"]);
});

test("resizing desktop analysis to a phone restores compact chart proportions", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: /信号仪表/ }).click();
  const scope = page.getByRole("img", { name: "多通道示波图", exact: true });
  const fft = page.getByRole("img", { name: "FFT 单边幅度谱", exact: true });
  await expect(fft).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const chart of [scope, fft]) {
    await expect.poll(async () => { const rect = await chart.boundingBox(); return rect!.height / rect!.width; }).toBeLessThan(.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1366, height: 768 });
  await windowFits(page, [".scope-card", ".signal-meters", ".signal-instrument-grid"]);
});
