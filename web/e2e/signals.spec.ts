import { test, expect, type Page } from "@playwright/test";

// Keep established wire/safety fixtures stable; i18n.spec.ts tests the English default.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("serialhub.ui.locale.v1", "zh-Hans"));
});
import { readFile } from "node:fs/promises";
async function connect(page: Page) {
  await page.goto("/"); await page.getByRole("button", { name: "连接 Hub", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("HTTP + WS");
  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: /信号仪表/ }).click();
}
async function write(page: Page, text: string) {
  const response = await page.request.post("/v1/write", { data: { text, newline: false } });
  expect((await response.json()).ok).toBe(true);
}
async function writeHex(page: Page, bytes: Uint8Array) {
  const response = await page.request.post("/v1/write", { data: { hex: [...bytes].map(value => value.toString(16).padStart(2, "0")).join(" ") } });
  expect((await response.json()).ok).toBe(true);
}
function tones(count = 1024) {
  return Array.from({ length: count }, (_, index) => `imu:${(2 * Math.sin(2 * Math.PI * 64 * index / 1024)).toFixed(5)},${Math.cos(2 * Math.PI * 64 * index / 1024).toFixed(5)},${(10 + index / count).toFixed(4)}\n`).join("");
}

test("actual FireWater stream produces multichannel traces, calibrated FFT, and bounded history", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await connect(page); await page.getByLabel("信号解析协议", { exact: true }).selectOption("firewater");
  await page.getByLabel("设备采样率", { exact: true }).fill("1024");
  await write(page, tones());
  await expect(page.getByTestId("spectrum-peak")).toContainText("64 Hz");
  await expect(page.locator('.signal-scope path[data-channel="0"]')).toHaveAttribute("d", /^M.+L/);
  await expect(page.locator('.signal-scope path[data-channel="1"]')).toHaveAttribute("d", /^M.+L/);
  await expect(page.locator(".signal-acquisition-stats")).toContainText("1,024");
  await expect(page.locator(".source-pill")).toContainText("MOCK");
  await page.getByRole("button", { name: "冻结画面", exact: true }).click();
  const old = await page.getByTestId("meter-value-2").textContent();
  await write(page, "imu:3,4,999\n");
  await expect(page.getByTestId("meter-value-2")).toHaveText(old!);
  await page.getByRole("button", { name: "跟随最新", exact: true }).click();
  await expect(page.getByTestId("meter-value-2")).toHaveText("999");
  expect(errors).toEqual([]);
});

test("terminal display pause does not pause signal acquisition or shift missing channels", async ({ page }) => {
  await connect(page); await page.getByLabel("信号解析协议", { exact: true }).selectOption("firewater");
  await page.getByRole("button", { name: /实时工作台/ }).click();
  await page.getByLabel("暂停显示", { exact: true }).check();
  await write(page, "imu:1,,3\n");
  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: /信号仪表/ }).click();
  await expect(page.getByTestId("meter-value-0")).toHaveText("1");
  await expect(page.getByTestId("meter-value-1")).toHaveText("—");
  await expect(page.getByTestId("meter-value-2")).toHaveText("3");
});

test("offline CSV supports FFT, scrubbing, stepping, export, and no device writes", async ({ page }) => {
  let writes = 0; page.on("request", request => { if (request.url().endsWith("/v1/write")) writes++; });
  await page.goto("/"); await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: /信号仪表/ }).click();
  const csv = "# sample_rate_hz=512\nSine,Cosine\n" + Array.from({ length: 512 }, (_, index) => `${Math.sin(2 * Math.PI * 50 * index / 512)},${Math.cos(2 * Math.PI * 50 * index / 512)}\n`).join("");
  await page.getByLabel("导入信号 CSV", { exact: true }).setInputFiles({ name: "tone.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByLabel("FFT 点数", { exact: true }).selectOption("256");
  await expect(page.getByTestId("spectrum-peak")).toContainText("50 Hz");
  await expect(page.getByLabel("设备采样率", { exact: true })).toHaveValue("512");
  await page.getByLabel("回放位置", { exact: true }).fill("200");
  await page.getByRole("button", { name: "单步", exact: true }).click();
  await expect(page.getByLabel("回放位置", { exact: true })).toHaveValue("201");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出缓存 CSV", exact: true }).click();
  const downloaded = await downloading;
  const text = await readFile((await downloaded.path())!, "utf8");
  expect(text.split("\n")).toHaveLength(515); expect(text).toContain("sample_rate_hz=512");
  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: /实时工作台/ }).click();
  await expect(page.locator(".waveform-panel .hint")).toContainText("CSV 离线回放");
  expect(writes).toBe(0);
});

test("waveform cursors, zoom, panning, and PNG export operate on the frozen view", async ({ page }) => {
  await connect(page); await page.getByLabel("信号解析协议", { exact: true }).selectOption("firewater");
  await write(page, tones(2048));
  await expect(page.locator(".scope-status")).toContainText("1,024 点");
  await page.getByRole("button", { name: "放大波形", exact: true }).click();
  await expect(page.getByLabel("波形窗口点数", { exact: true })).toHaveValue("512");
  await expect(page.locator(".scope-status")).toContainText("已冻结");
  await expect(page.getByTestId("spectrum-peak")).toContainText("62.5 Hz");
  await page.getByLabel("分轨显示", { exact: true }).check();
  const chart = page.getByRole("img", { name: "多通道示波图", exact: true });
  const box = await chart.boundingBox();
  await page.getByLabel("波形交互模式", { exact: true }).selectOption("a");
  await chart.click({ position: { x: box!.width * .3, y: box!.height * .5 } });
  await page.getByLabel("波形交互模式", { exact: true }).selectOption("b");
  await chart.click({ position: { x: box!.width * .7, y: box!.height * .5 } });
  await expect(page.locator(".signal-cursors")).not.toContainText("Δt —");
  await chart.focus(); await chart.press("ArrowLeft");
  expect(Number(await page.getByLabel("波形历史位置", { exact: true }).inputValue())).toBeGreaterThan(0);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出波形 PNG", exact: true }).click();
  const file = await downloading;
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
});

test("single trigger captures only a future rising edge with post-trigger samples", async ({ page }) => {
  await connect(page); await page.getByLabel("信号解析协议", { exact: true }).selectOption("firewater");
  await page.getByLabel("波形窗口点数", { exact: true }).selectOption("32");
  await write(page, "imu:-1,0\n".repeat(40));
  await expect(page.getByTestId("meter-value-0")).toHaveText("-1");
  await page.getByRole("button", { name: "等待触发", exact: true }).click();
  await write(page, "imu:-1,0\n".repeat(10) + "imu:1,0\n".repeat(40));
  await expect(page.locator(".signal-trigger")).toContainText("已捕获");
  await expect(page.locator(".scope-status")).toContainText("已冻结");
  await expect(page.locator(".scope-status")).toContainText("32 点");
});

test("JustFloat binary data decodes across real HTTP writes", async ({ page }) => {
  await connect(page); await page.getByLabel("信号解析协议", { exact: true }).selectOption("justfloat");
  const bytes = new Uint8Array(24); const view = new DataView(bytes.buffer);
  view.setFloat32(0, 1.25, true); view.setFloat32(4, -2.5, true); bytes.set([0, 0, 128, 127], 8);
  view.setFloat32(12, -1.5, true); view.setFloat32(16, 7, true); bytes.set([0, 0, 128, 127], 20);
  await writeHex(page, bytes.subarray(0, 5)); await writeHex(page, bytes.subarray(5));
  await expect(page.getByTestId("meter-value-0")).toHaveText("-1.5"); await expect(page.getByTestId("meter-value-1")).toHaveText("7");
});

test("raw RGB image frames render exact pixels without pretending to be compressed image protocols", async ({ page }) => {
  await connect(page);
  await page.getByRole("button", { name: "通道与数据帧配置", exact: true }).click();
  await page.getByLabel("图像宽", { exact: true }).fill("2"); await page.getByLabel("图像高", { exact: true }).fill("2");
  await page.getByLabel("图像像素格式", { exact: true }).selectOption("rgb888"); await page.getByLabel("图像帧头", { exact: true }).fill("aa 55");
  await page.getByRole("button", { name: "应用帧配置", exact: true }).click();
  await page.getByRole("button", { name: "关闭通道与数据帧配置", exact: true }).click();
  await page.getByLabel("信号解析协议", { exact: true }).selectOption("image");
  await writeHex(page, Uint8Array.of(0xaa, 0x55, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255));
  const canvas = page.getByRole("img", { name: "收到的原始图像帧", exact: true });
  await expect(canvas).toHaveAttribute("width", "2");
  const pixels = await canvas.evaluate(node => Array.from((node as HTMLCanvasElement).getContext("2d")!.getImageData(0, 0, 2, 2).data));
  expect(pixels).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
});

test("manual control slider uses the shared TX gate and sends exact UTF-8 bytes", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", request => { if (request.url().endsWith("/v1/write")) writes.push(request.postDataJSON().hex); });
  await connect(page); await page.getByLabel("仪表布局", { exact: true }).selectOption("instruments");
  await page.getByRole("tab", { name: "参数控制", exact: true }).click();
  await page.getByLabel("仪表设定值", { exact: true }).fill("37");
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "发送设定值", exact: true }).click();
  await expect(page.locator(".control-deck")).toContainText("主机已确认");
  expect(writes).toEqual(["53 45 54 3a 33 37 0a"]);
});

test("mobile instruments and five-item navigation stay inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await connect(page);
  await page.getByLabel("信号解析协议", { exact: true }).selectOption("firewater"); await write(page, tones());
  await expect(page.locator(".signal-scope")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("仪表布局", { exact: true }).selectOption("full");
  await expect(page.locator(".attitude-card")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("full sixteen-channel cache remains bounded and reduces displayed vertices", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("serialhub.signals.v1", JSON.stringify({ sampleRate: 1000, fftSize: 1024, window: "hann", layout: "analysis",
      binary: { type: "float32", channels: 3, littleEndian: true, header: "" }, image: { width: 128, height: 128, format: "gray8", header: "" },
      channels: Array.from({ length: 64 }, (_, index) => ({ name: `CH${index}`, unit: "", color: "#38bdf8", gain: 1, offset: 0, min: -1, max: 1, visible: index < 16 })) }));
  });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await connect(page); await page.getByLabel("信号解析协议", { exact: true }).selectOption("firewater");
  await page.getByLabel("波形窗口点数", { exact: true }).selectOption("16384");
  for (let block = 0; block < 20; block++) {
    await write(page, Array.from({ length: 1000 }, (_, index) => `s:${Array.from({ length: 16 }, (_, channel) => (index + block + channel) % 10).join(",")}\n`).join(""));
  }
  await expect(page.locator(".signal-acquisition-stats")).toContainText("16,384");
  await expect(page.locator(".signal-acquisition-stats")).toContainText("3,616");
  await expect(page.locator(".signal-scope path[data-channel]")).toHaveCount(16);
  const vertices = await page.locator(".signal-scope path[data-channel]").evaluateAll(nodes => nodes.map(node => (node.getAttribute("d")?.match(/[ML]/g) ?? []).length));
  expect(vertices.every(count => count > 0 && count < 1300)).toBe(true);
  expect(errors).toEqual([]);
});

test("channel units, custom control range, and instrument configuration survive reload", async ({ page }) => {
  await connect(page);
  await page.getByRole("button", { name: "通道与数据帧配置", exact: true }).click();
  await page.getByLabel("CH0 名称", { exact: true }).fill("Motor speed");
  await page.getByLabel("CH0 单位", { exact: true }).fill("RPM");
  await page.getByRole("button", { name: "关闭通道与数据帧配置", exact: true }).click();
  await page.getByLabel("仪表布局", { exact: true }).selectOption("instruments");
  await page.getByRole("tab", { name: "参数控制", exact: true }).click();
  await page.locator(".control-range-settings > summary").click();
  await page.getByLabel("控件上限", { exact: true }).fill("4095");
  await page.getByRole("button", { name: "应用控件量程", exact: true }).click();
  await page.reload(); await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: /信号仪表/ }).click();
  await page.getByRole("button", { name: "通道与数据帧配置", exact: true }).click();
  await expect(page.getByLabel("CH0 名称", { exact: true })).toHaveValue("Motor speed");
  await expect(page.getByLabel("CH0 单位", { exact: true })).toHaveValue("RPM");
  await page.getByRole("button", { name: "关闭通道与数据帧配置", exact: true }).click();
  await page.getByRole("tab", { name: "参数控制", exact: true }).click();
  await expect(page.getByLabel("参数滑块", { exact: true })).toHaveAttribute("max", "4095");
  await expect(page.getByRole("button", { name: "发送设定值", exact: true })).toBeDisabled();
});

test("replay disables instrument writes even when the physical Hub remains connected", async ({ page }) => {
  await connect(page);
  await page.getByLabel("导入信号 CSV", { exact: true }).setInputFiles({ name: "safe.csv", mimeType: "text/csv", buffer: Buffer.from("CH0,CH1,CH2\n1,2,3\n4,5,6\n") });
  await expect(page.locator(".source-pill")).toContainText("离线回放");
  await page.getByLabel("仪表布局", { exact: true }).selectOption("instruments");
  await page.getByRole("tab", { name: "参数控制", exact: true }).click();
  await expect(page.getByRole("button", { name: "发送设定值", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "返回实时采集", exact: true }).click();
  await expect(page.getByRole("button", { name: "发送设定值", exact: true })).toBeEnabled();
});

test("single trigger reports an overwritten capture instead of claiming an empty acquisition", async ({ page }) => {
  await connect(page); await page.getByLabel("信号解析协议", { exact: true }).selectOption("firewater");
  await page.getByLabel("波形窗口点数", { exact: true }).selectOption("32");
  await write(page, "-1\n".repeat(40));
  await expect(page.getByTestId("meter-value-0")).toHaveText("-1");
  await page.getByRole("button", { name: "等待触发", exact: true }).click();
  await write(page, "1\n".repeat(8));
  await expect(page.locator(".signal-trigger")).toContainText("等待后半窗");
  await write(page, "1\n".repeat(20000));
  await expect(page.locator(".signal-trigger")).toContainText("已被缓存覆盖");
  await expect(page.locator(".scope-status")).toContainText("LIVE");
});

test("ledger and metrics load only when their workspace is opened", async ({ page }) => {
  let ledger = 0, metrics = 0;
  page.on("request", request => { if (/\/v1\/events(?:[/?]|$)/.test(request.url())) ledger++; if (request.url().endsWith("/v1/metrics")) metrics++; });
  await connect(page); expect(ledger).toBe(0); expect(metrics).toBe(0);
  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: /事件与指标/ }).click();
  await expect(page.locator(".event-row").first()).toBeVisible();
  expect(ledger).toBeGreaterThan(0); expect(metrics).toBeGreaterThan(0);
});

test("metadata failure marks cached signals offline and cancels a pending trigger", async ({ page }) => {
  await connect(page); await page.getByLabel("信号解析协议", { exact: true }).selectOption("firewater");
  await write(page, "s:-1,0\n".repeat(40)); await expect(page.getByTestId("meter-value-0")).toHaveText("-1");
  await page.getByRole("button", { name: "等待触发", exact: true }).click();
  await page.route("**/v1/status", route => route.fulfill({ status: 503, json: { error: "metadata unavailable" } }));
  await expect(page.getByRole("status").first()).toContainText("连接异常");
  await expect(page.locator(".source-pill")).toContainText("等待设备连接");
  await expect(page.locator(".scope-status")).toContainText("离线缓存");
  await expect(page.locator(".signal-trigger")).toContainText("触发已取消");
});
