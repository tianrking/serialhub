import { test, expect, type Page } from "@playwright/test";

async function connect(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "连接 Hub", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("HTTP + WS");
}

test("real embedded workspace connects, writes UTF-8, filters, and exports logs", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await connect(page);
  // Reusing a local Hub can legitimately replay the previous run's history.
  const marker = `workspace-中文-🙂-${Date.now()}`;
  await page.getByPlaceholder("例如 AT 或任意指令").fill(marker);
  await page.getByRole("button", { name: "发送文本", exact: true }).click();
  await expect(page.locator(".line.rx").filter({ hasText: marker })).toBeVisible();
  await page.getByLabel("搜索终端日志").fill(marker);
  await expect(page.locator(".line")).toHaveCount(2);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出日志", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/serialhub-.*\.log$/);
  await page.getByRole("button", { name: "清空", exact: true }).click();
  await page.getByLabel("搜索终端日志").fill("");
  await expect(page.locator(".line.rx")).toHaveCount(0);
  await page.getByRole("button", { name: "断开", exact: true }).click();
  await expect(page.getByRole("button", { name: "发送文本", exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("disconnect cancels a delayed connection and a late response cannot restore it", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let started = () => {};
  const pending = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/v1/health", async route => {
    started(); await held;
    await route.fulfill({ json: { ok: true } }).catch(() => {});
  });
  await page.goto("/");
  await page.getByRole("button", { name: "连接 Hub", exact: true }).click();
  await pending;
  await page.getByRole("button", { name: "断开", exact: true }).click();
  release();
  await expect(page.getByRole("status").first()).toHaveText("未连接");
  await expect(page.getByRole("button", { name: "连接 Hub", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "发送文本", exact: true })).toBeDisabled();
});

test("keyboard shortcuts cannot bypass offline state or submit twice", async ({ page }) => {
  let writes = 0;
  await page.route("**/v1/write", async route => {
    writes++;
    await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({ json: { ok: true, bytes: 5 } });
  });
  await page.goto("/");
  const input = page.getByPlaceholder("例如 AT 或任意指令");
  await input.fill("test");
  await input.press("Control+Enter");
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "连接 Hub", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("HTTP + WS");
  await input.evaluate(element => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  });
  await expect(page.locator(".line.tx")).toHaveCount(1);
  expect(writes).toBe(1);
});

test("reconnecting a stream stops automatic TX and never silently resumes it", async ({ page }) => {
  let closeStream = () => {};
  let sockets = 0;
  await page.routeWebSocket("**/v1/stream", socket => {
    sockets++;
    closeStream = () => socket.close();
    socket.send(Buffer.from("stream-connected\n"));
  });
  await connect(page);
  await page.getByPlaceholder("例如 AT 或任意指令").fill("safe-timer");
  await page.locator(".auto-send-settings summary").click();
  const auto = page.getByRole("checkbox", { name: "定时发送当前内容" });
  await auto.check();
  closeStream();
  await expect(auto).not.toBeChecked();
  await expect(page.getByRole("status").first()).toContainText("HTTP + WS");
  expect(sockets).toBe(2);
  await expect(auto).not.toBeChecked();
});

test("expired write leases are cleared and mock control lines stay disabled", async ({ page }) => {
  await page.route("**/v1/lock", route => route.fulfill({ json: {
    ok: true, lock: { owner: "web-ui", expires_ms: 600, lease_token: "test-only-lease" },
  } }));
  await connect(page);
  await page.getByRole("button", { name: "获取写入租约", exact: true }).click();
  await expect(page.locator(".lease-countdown")).toBeVisible();
  await expect(page.locator(".lease-countdown")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "释放租约", exact: true })).toBeDisabled();
  await page.locator(".hardware-controls summary").click();
  await expect(page.getByRole("button", { name: "DTR ON", exact: true })).toBeDisabled();
});

test("edited credentials do not replace credentials bound to the live session", async ({ page }) => {
  const tokens: string[] = [];
  await page.route("**/v1/status", route => {
    tokens.push(route.request().headers().authorization);
    return route.continue();
  });
  await page.goto("/");
  await page.getByPlaceholder("仅在本次会话使用").fill("test-token-one");
  await page.getByRole("button", { name: "连接 Hub", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("HTTP + WS");
  await page.getByPlaceholder("仅在本次会话使用").fill("test-token-two");
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await expect.poll(() => tokens.length).toBeGreaterThan(1);
  expect(tokens.every(token => token === "Bearer test-token-one")).toBe(true);
});

test("mobile workspace fits the viewport and navigation remains accessible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await connect(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: /事件与指标/ }).click();
  await expect(page.getByRole("heading", { name: "事件与运行指标", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("device disconnect disables writes and stops scheduled sending", async ({ page }) => {
  let deviceConnected = true;
  await page.route("**/v1/status", async route => {
    const response = await route.fetch();
    const status = await response.json();
    status.port.connected = deviceConnected;
    await route.fulfill({ json: status });
  });
  await connect(page);
  await page.getByPlaceholder("例如 AT 或任意指令").fill("device-disconnect");
  await page.locator(".auto-send-settings summary").click();
  const auto = page.getByRole("checkbox", { name: "定时发送当前内容" });
  await auto.check();
  deviceConnected = false;
  await expect(page.getByRole("button", { name: "发送文本", exact: true })).toBeDisabled();
  await expect(auto).not.toBeChecked();
});

test("an incompatible service is reported without crashing the workspace", async ({ page }) => {
  await page.route("**/v1/status", route => route.fulfill({ json: {} }));
  await page.goto("/");
  await page.getByRole("button", { name: "连接 Hub", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("不兼容的状态数据");
  await expect(page.getByRole("button", { name: "发送文本", exact: true })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "串口工作台", exact: true })).toBeVisible();
});

test("HTTPS pages use HTTPS requests and a WSS stream", async ({ page }) => {
  // Route interception tests URL generation and mixed-content behavior; this
  // does not certify a deployed reverse proxy or its TLS certificates.
  let streamUrl = "";
  await page.route("https://console.example.test/**", async route => {
    const url = route.request().url().replace("https://console.example.test", "http://127.0.0.1:18887");
    const response = await route.fetch({ url });
    await route.fulfill({ response });
  });
  await page.routeWebSocket("wss://console.example.test/v1/stream", socket => {
    streamUrl = socket.url();
    socket.send(Buffer.from("secure-endpoint\n"));
  });
  await page.goto("https://console.example.test/");
  await expect(page.getByLabel("连接协议")).toHaveValue("https");
  await page.getByRole("button", { name: "连接 Hub", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("HTTP + WS");
  await expect(page.locator(".line.rx")).toContainText("secure-endpoint");
  expect(streamUrl).toBe("wss://console.example.test/v1/stream");
});
