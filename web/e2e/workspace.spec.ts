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
  await page.routeWebSocket("**/v1/stream*", socket => {
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
  await page.locator(".hardware-controls:not(.serial-settings) summary").click();
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
  await page.routeWebSocket("wss://console.example.test/v1/stream*", socket => {
    streamUrl = socket.url();
    socket.send(Buffer.from("secure-endpoint\n"));
  });
  await page.goto("https://console.example.test/");
  await expect(page.getByLabel("连接协议")).toHaveValue("https");
  await page.getByRole("button", { name: "连接 Hub", exact: true }).click();
  await expect(page.getByRole("status").first()).toContainText("HTTP + WS");
  await expect(page.locator(".line.rx")).toContainText("secure-endpoint");
  expect(streamUrl).toBe("wss://console.example.test/v1/stream?live=true");
  await page.getByRole("button", { name: "断开", exact: true }).click();
  await page.unrouteAll({ behavior: "wait" });
});

test("binary file TX and paused-display raw RX preserve every byte", async ({ page }) => {
  await connect(page);
  // Drain the first history hint before a user starts a new live recording.
  const marker = `capture-ready-${Date.now()}`;
  await page.getByPlaceholder("例如 AT 或任意指令").fill(marker);
  await page.getByRole("button", { name: "发送文本", exact: true }).click();
  await expect(page.locator(".line.rx").filter({ hasText: marker })).toBeVisible();
  await page.getByLabel("暂停显示", { exact: true }).check();
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  const bytes = Buffer.from(Array.from({ length: 1028 }, (_, index) => index % 256));
  await page.getByLabel("选择发送文件", { exact: true }).setInputFiles({ name: "binary.bin", mimeType: "application/octet-stream", buffer: bytes });
  await page.getByLabel("文件每块字节", { exact: true }).selectOption("256");
  await page.getByRole("button", { name: "发送文件", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "文件发送进度" })).toHaveAttribute("value", "1028");
  await expect(page.locator(".capture-size")).toContainText("1,028");
  await expect(page.locator(".job-status")).toHaveCount(0);
  await page.getByRole("button", { name: "停止录制", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载接收文件", exact: true }).click();
  const download = await downloading;
  const { readFile } = await import("node:fs/promises");
  expect(await readFile((await download.path())!)).toEqual(bytes);
  const tx = page.getByTestId("session-tx");
  await expect(tx).toHaveText((bytes.length + Buffer.byteLength(marker + "\n")).toLocaleString("en-US"));
  await page.getByRole("button", { name: "统计清零", exact: true }).click();
  await expect(tx).toHaveText("0");
});

test("stopping a file job waits for its current ACK and never sends the next block", async ({ page }) => {
  let count = 0;
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let started = () => {};
  const pending = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/v1/write", async route => {
    count++; started(); await held;
    await route.fulfill({ json: { ok: true, bytes: 64 } });
  });
  await connect(page);
  await page.getByLabel("选择发送文件", { exact: true }).setInputFiles({ name: "cancel.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(256, 42) });
  await page.getByLabel("文件每块字节", { exact: true }).selectOption("64");
  await page.getByRole("button", { name: "发送文件", exact: true }).click();
  await pending;
  await page.getByRole("button", { name: /事件与指标/ }).click();
  await page.getByRole("button", { name: "停止发送任务", exact: true }).click();
  await expect(page.locator(".job-status")).toBeVisible();

  release();
  await expect(page.locator(".job-status")).toHaveCount(0);
  await page.getByRole("button", { name: /实时工作台/ }).click();
  await expect(page.getByRole("progressbar", { name: "文件发送进度" })).toHaveAttribute("value", "64");
  expect(count).toBe(1);
});

test("selected commands run sequentially in the chosen order and fail closed", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ohmyserial.web.quickCommands", JSON.stringify([
    { id: "a", name: "Alpha", mode: "hex", payload: "00 ff", lineEnding: "none" },
    { id: "b", name: "Beta", mode: "text", payload: "AT", lineEnding: "crlf" },
  ])));
  const writes: string[] = [];
  await page.route("**/v1/write", async route => {
    const body = route.request().postDataJSON(); writes.push(body.hex);
    await route.fulfill({ json: writes.length === 3 ? { ok: false, bytes: 0, error: "lease expired" } : { ok: true, bytes: body.hex.split(" ").length } });
  });
  await connect(page);
  await page.getByRole("tab", { name: "多条轮发", exact: true }).click();
  await page.getByRole("button", { name: "上移 Beta", exact: true }).click();
  await page.getByLabel("循环轮数", { exact: true }).fill("2");
  await page.getByLabel("Alpha 延时", { exact: true }).fill("50");
  await page.getByLabel("Beta 延时", { exact: true }).fill("50");
  await page.getByRole("button", { name: "开始轮发", exact: true }).click();
  await expect(page.locator(".line.err").filter({ hasText: "lease expired" })).toBeVisible();
  await expect(page.locator(".job-status")).toHaveCount(0);
  expect(writes).toEqual(["41 54 0d 0a", "00 ff", "41 54 0d 0a"]);
});

test("GBK text sends exact bytes and rejects characters without a representation", async ({ page }) => {
  const writes: string[] = [];
  await page.route("**/v1/write", async route => {
    const body = route.request().postDataJSON(); writes.push(body.hex);
    await route.fulfill({ json: { ok: true, bytes: body.hex.split(" ").length } });
  });
  await connect(page);
  await page.getByLabel("发送文本编码", { exact: true }).selectOption("gbk");
  await page.getByPlaceholder("例如 AT 或任意指令").fill("中文");
  await page.getByRole("button", { name: "发送文本", exact: true }).click();
  await expect(page.locator(".line.tx")).toHaveCount(1);
  expect(writes).toEqual(["d6 d0 ce c4 0a"]);
  await page.getByPlaceholder("例如 AT 或任意指令").fill("🙂");
  await page.getByRole("button", { name: "发送文本", exact: true }).click();
  await expect(page.locator(".line.err").filter({ hasText: "无法编码" })).toBeVisible();
  expect(writes).toHaveLength(1);
});

test("configuration imports are previewed, validated, and appended without credentials", async ({ page }) => {
  await connect(page);
  await page.getByRole("tab", { name: "配置迁移", exact: true }).click();
  const backup = { format: "serialhub-workspace", version: 1,
    commands: [{ id: "ignored", name: "Imported", mode: "hex", payload: "00 ff", lineEnding: "none" }],
    profiles: [{ id: "ignored", name: "Lab", host: "::1", port: 443, protocol: "https", token: "must-be-stripped" }] };
  await page.getByLabel("导入配置文件", { exact: true }).setInputFiles({ name: "workspace.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator(".import-preview")).toContainText("1 条指令 · 1 个连接");
  await expect(page.locator(".quick-item")).toHaveCount(0);
  await page.getByRole("button", { name: "确认追加导入", exact: true }).click();
  await expect(page.locator(".quick-item")).toContainText("Imported");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出工作区配置", exact: true }).click();
  const download = await downloading;
  const { readFile } = await import("node:fs/promises");
  const text = await readFile((await download.path())!, "utf8");
  expect(text).not.toContain("must-be-stripped");
  expect(JSON.parse(text).profiles[0].protocol).toBe("https");
  backup.commands[0]!.payload = "zz";
  await page.getByLabel("导入配置文件", { exact: true }).setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator(".line.err").filter({ hasText: "Hex" })).toBeVisible();
  await expect(page.locator(".quick-item")).toHaveCount(1);
});

test("live recording accepts its first packet and stops on disconnect", async ({ page }) => {
  await connect(page);
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  await page.getByPlaceholder("例如 AT 或任意指令").fill("first-live");
  await page.getByRole("button", { name: "发送文本", exact: true }).click();
  await expect(page.locator(".capture-size")).toContainText("11");
  await page.getByRole("button", { name: "断开", exact: true }).click();
  await expect(page.locator(".capture-reason")).toContainText("停止");
  await expect(page.getByRole("button", { name: "下载接收文件", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "开始录制", exact: true })).toBeDisabled();
});

test("an active sequence renews only its original lease and stops when renewal fails", async ({ page }) => {
  let locks = 0, writes = 0;
  await page.addInitScript(() => localStorage.setItem("ohmyserial.web.quickCommands", JSON.stringify([
    { id: "lease-command", name: "Leased", mode: "hex", payload: "01", lineEnding: "none", delayMs: 1200 },
  ])));
  await page.route("**/v1/lock", async route => {
    locks++;
    const body = route.request().postDataJSON();
    if (locks > 1) expect(body.lease_token).toBe("original-lease");
    await route.fulfill({ json: locks >= 4 ? { ok: false, error: "write lease expired" } : {
      ok: true, lock: { owner: "web-ui", lease_token: "original-lease", expires_ms: 2000 },
    } });
  });
  await page.route("**/v1/write", async route => {
    writes++;
    expect(route.request().postDataJSON().lease_token).toBe("original-lease");
    await route.fulfill({ json: { ok: true, bytes: 1 } });
  });
  await connect(page);
  await page.getByRole("button", { name: "获取写入租约", exact: true }).click();
  await page.getByRole("tab", { name: "多条轮发", exact: true }).click();
  await page.getByLabel("循环轮数", { exact: true }).fill("0");
  await page.getByRole("button", { name: "开始轮发", exact: true }).click();
  await expect(page.locator(".line.err").filter({ hasText: "write lease expired" })).toBeVisible();
  await expect(page.locator(".job-status")).toHaveCount(0);
  expect(locks).toBe(4);
  expect(writes).toBeGreaterThan(0);
  expect(writes).toBeLessThan(4);
});

test("large packet display stays bounded while raw recording keeps all bytes", async ({ page }) => {
  await connect(page);
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  const payload = "A".repeat(6000);
  await page.getByPlaceholder("例如 AT 或任意指令").fill(payload);
  await page.getByRole("button", { name: "发送文本", exact: true }).click();
  await expect(page.locator(".capture-size")).toContainText("6,001");
  await expect(page.locator(".line.rx .msg")).toContainText("显示已截断");
  expect(await page.locator(".line.rx .msg").evaluate(element => element.textContent?.length ?? 0)).toBeLessThan(4200);
  await page.getByRole("button", { name: "停止录制", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载接收文件", exact: true }).click();
  const { readFile } = await import("node:fs/promises");
  expect(await readFile((await (await downloading).path())!, "utf8")).toBe(payload + "\n");
});

test("a changed device epoch stops recording and prevents subsequent file chunks", async ({ page }) => {
  let changed = false, count = 0;
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  let started = () => {};
  const pending = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/v1/status", async route => {
    const response = await route.fetch();
    const body = await response.json();
    if (changed) body.port.epoch += 10;
    await route.fulfill({ json: body });
  });
  await page.route("**/v1/write", async route => {
    count++; started(); await held;
    await route.fulfill({ json: { ok: true, bytes: 64 } });
  });
  await connect(page);
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  await page.getByLabel("选择发送文件", { exact: true }).setInputFiles({ name: "epoch.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(256, 42) });
  await page.getByLabel("文件每块字节", { exact: true }).selectOption("64");
  await page.getByRole("button", { name: "发送文件", exact: true }).click();
  await pending;
  changed = true;
  await expect(page.locator(".capture-reason")).toContainText("更换");
  release();
  await expect(page.locator(".job-status")).toHaveCount(0);
  await expect(page.locator(".line.err").filter({ hasText: "连接代次已改变" })).toBeVisible();
  expect(count).toBe(1);
});
