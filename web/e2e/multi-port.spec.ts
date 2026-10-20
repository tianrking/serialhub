import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { translate, type Locale } from "../src/i18n/index";

test.use({
  baseURL: "http://127.0.0.1:18889",
  viewport: { width: 1366, height: 768 },
});
const settings = {
  baud: 115200,
  databits: 8,
  parity: "none",
  stopbits: 1,
  flow: "none",
};
async function create(request: APIRequestContext, count = 4) {
  const devices: { id: string; path: string; name: string }[] = [];
  for (let i = 0; i < count; i++) {
    const path = `mock:multi-${i}`,
      name = `Device ${i + 1}`;
    const response = await request.post("/manager/sessions", {
      data: { path, name, settings },
    });
    expect(response.ok()).toBe(true);
    devices.push({ ...(await response.json()), path, name });
  }
  return devices;
}
async function enter(page: Page, count = 4) {
  await page.goto("/");
  await page
    .getByRole("tab", { name: "Multi-port workspace", exact: true })
    .click();
  await expect(page.locator(".port-panel:visible .port-state")).toHaveText(
    Array.from({ length: count }, () => "Receiving"),
  );
}
function panel(page: Page, path: string) {
  return page.locator(`.port-panel[data-device="${path}"]`);
}

test.beforeEach(async ({ request }) => {
  const info = await (await request.get("/manager/info")).json();
  for (const session of info.sessions)
    await request.delete(`/manager/sessions/${session.id}`);
  await request.delete("/manager/lan");
});

test("four live panels send to their own devices with one header and no desktop page scroll", async ({
  page,
  request,
}) => {
  const devices = await create(request);
  await enter(page);
  const a = panel(page, devices[0].path),
    b = panel(page, devices[1].path);
  await a
    .getByRole("textbox", { name: "Command for Device 1", exact: true })
    .fill("alpha-only");
  await a
    .getByRole("button", { name: "Send to mock:multi-0", exact: true })
    .click();
  await expect(a.locator(".port-entry.rx")).toContainText(["alpha-only"]);
  await expect(b.locator(".port-entry.rx")).toHaveCount(0);
  await b.getByRole("button", { name: "HEX", exact: true }).click();
  await b
    .getByRole("textbox", { name: "Command for Device 2", exact: true })
    .fill("00 7f 80 ff");
  await b
    .getByRole("combobox", { name: "Display", exact: true })
    .selectOption("hex");
  await b
    .getByRole("textbox", { name: "Command for Device 2", exact: true })
    .press("Control+Enter");
  await expect(b.locator(".port-entry.rx")).toContainText(["00 7f 80 ff"]);
  expect(
    (await (await request.get(`/sessions/${devices[1].id}/v1/status`)).json())
      .stats.tx_bytes,
  ).toBe(4);
  await expect(a.locator(".port-entry.rx")).not.toContainText(["00 7f 80 ff"]);
  await expect(page.locator(".manager-toolbar")).toBeHidden();
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(
    page.getByRole("button", { name: "Application menu", exact: true }),
  ).toHaveCount(1);
  expect(await page.locator(".language-selector:visible").count()).toBe(1);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollHeight <= innerHeight &&
        document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const card of await page.locator(".port-panel:visible").all()) {
    expect(
      await card.locator(".port-log").evaluate((node) => node.clientHeight),
    ).toBeGreaterThan(60);
    const box = await card
      .getByRole("button", { name: /^Send to / })
      .boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(768);
  }
});

test("paused displays keep receiving; filtering, export and per-port clear stay isolated", async ({
  page,
  request,
}) => {
  const devices = await create(request);
  await enter(page);
  const a = panel(page, devices[0].path),
    b = panel(page, devices[1].path);
  await request.post(`/sessions/${devices[0].id}/v1/write`, {
    data: { text: "before-pause" },
  });
  await expect(a.locator(".port-entry.rx")).toContainText(["before-pause"]);
  await a.getByRole("button", { name: "Pause display", exact: true }).click();
  await request.post(`/sessions/${devices[0].id}/v1/write`, {
    data: { text: "arrived-while-paused" },
  });
  await request.post(`/sessions/${devices[1].id}/v1/write`, {
    data: { text: "other-still-live" },
  });
  await expect(b.locator(".port-entry.rx")).toContainText(["other-still-live"]);
  await expect(
    a.locator(".port-entry.rx").filter({ hasText: "arrived-while-paused" }),
  ).toHaveCount(0);
  await a.getByRole("button", { name: "Resume display", exact: true }).click();
  await expect(a.locator(".port-entry.rx")).toContainText([
    "before-pause",
    "arrived-while-paused",
  ]);
  await a
    .getByRole("textbox", { name: "Filter this log", exact: true })
    .fill("arrived");
  await expect(a.locator(".port-entry")).toHaveCount(1);
  const downloading = page.waitForEvent("download");
  await a
    .getByRole("button", { name: "Export visible log", exact: true })
    .click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toContain("arrived-while-paused");
  expect(Buffer.concat(chunks).toString()).not.toContain("other-still-live");
  await a.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(a.locator(".port-entry")).toHaveCount(0);
  await expect(b.locator(".port-entry.rx")).toContainText(["other-still-live"]);
  await page
    .getByRole("button", { name: "Pause all displays", exact: true })
    .click();
  await request.post(`/sessions/${devices[1].id}/v1/write`, {
    data: { text: "globally-paused" },
  });
  await expect(
    b.getByRole("button", { name: "Pause display", exact: true }),
  ).toBeDisabled();
  await expect(
    b.locator(".port-entry.rx").filter({ hasText: "globally-paused" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Resume all displays", exact: true })
    .click();
  await expect(b.locator(".port-entry.rx")).toContainText([
    "other-still-live",
    "globally-paused",
  ]);
  await page
    .getByRole("button", { name: "Clear all displays", exact: true })
    .click();
  await expect(page.locator(".multi-workspace .port-entry")).toHaveCount(0);
});

test("all tiled panels and full-workspace switching retain drafts and background acquisition", async ({
  page,
  request,
}) => {
  const devices = await create(request, 6);
  await enter(page, 6);
  const a = panel(page, devices[0].path),
    last = panel(page, devices[5].path);
  await a
    .getByRole("textbox", { name: "Command for Device 1", exact: true })
    .fill("keep-this-draft");
  await request.post(`/sessions/${devices[5].id}/v1/write`, {
    data: { text: "background-panel-data" },
  });
  await expect(last).toBeVisible();
  await expect(last.locator(".port-entry.rx")).toContainText([
    "background-panel-data",
  ]);
  await expect(
    a.getByRole("textbox", { name: "Command for Device 1", exact: true }),
  ).toHaveValue("keep-this-draft");
  await a.getByRole("button", { name: "Focus panel", exact: true }).click();
  await expect(page.locator(".port-panel:visible")).toHaveCount(1);
  await a
    .getByRole("button", { name: "Open full workspace", exact: true })
    .click();
  await expect(
    page.locator(".managed-workspace:not([hidden]) .lamp"),
  ).toContainText("HTTP + WS");
  await page
    .getByRole("combobox", { name: "Device sessions", exact: true })
    .selectOption("__multi__");
  await expect(
    a.getByRole("textbox", { name: "Command for Device 1", exact: true }),
  ).toHaveValue("keep-this-draft");
  await a.getByRole("button", { name: "Restore grid", exact: true }).click();
  await expect(page.locator(".port-panel:visible")).toHaveCount(6);
  const info = await (await request.get("/manager/info")).json();
  expect(info.sessions).toHaveLength(6);
  expect(
    info.sessions.every(
      (s: { clients: number }) => s.clients >= 1 && s.clients <= 2,
    ),
  ).toBe(true);
});

test("a lease race rejects one send without replay and duplicate hotkeys do not submit twice", async ({
  page,
  request,
}) => {
  const devices = await create(request);
  await enter(page);
  const a = panel(page, devices[0].path);
  let token = "";
  await page.route(
    `**/sessions/${devices[0].id}/v1/write`,
    async (route) => {
      token = (
        await (
          await request.post(`/sessions/${devices[0].id}/v1/lock`, {
            data: { as_client: "external" },
          })
        ).json()
      ).lock.lease_token;
      await route.continue();
    },
    { times: 1 },
  );
  await a
    .getByRole("textbox", { name: "Command for Device 1", exact: true })
    .fill("denied-once");
  await a
    .getByRole("button", { name: "Send to mock:multi-0", exact: true })
    .click();
  await expect(a.locator(".port-result")).toHaveAttribute("role", "alert");
  await expect(a.locator(".port-entry.rx")).toHaveCount(0);
  await request.delete(`/sessions/${devices[0].id}/v1/lock`, {
    data: { lease_token: token },
  });
  const button = a.getByRole("button", {
    name: "Send to mock:multi-0",
    exact: true,
  });
  await expect(button).toBeEnabled();
  let calls = 0,
    release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/sessions/${devices[0].id}/v1/write`, async (route) => {
    calls++;
    await held;
    await route.continue();
  });
  await button.click();
  await expect(button).toBeDisabled();
  await a
    .getByRole("textbox", { name: "Command for Device 1", exact: true })
    .press("Control+Enter");
  release();
  await expect(a.locator(".port-entry.rx")).toContainText(["denied-once"]);
  expect(calls).toBe(1);
  expect(
    (await (await request.get(`/sessions/${devices[0].id}/v1/status`)).json())
      .stats.tx_bytes,
  ).toBe("denied-once\n".length);
});

test("removed devices cannot receive a stale response or leak drafts into replacement sessions", async ({
  page,
  request,
}) => {
  const devices = await create(request);
  await enter(page);
  const a = panel(page, devices[0].path),
    b = panel(page, devices[1].path);
  // Delay only the completed write result. Keeping a CDP route handler pending
  // can stall unrelated requests and manager polling in Chromium during teardown.
  await page.evaluate((id) => {
    const probe = { started: false, release: () => {} };
    Object.assign(window, { __serialhubDelayedWrite: probe });
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const url = input instanceof Request ? input.url : String(input);
      if (!url.endsWith(`/sessions/${id}/v1/write`)) return response;
      const bytes = await response.arrayBuffer();
      probe.started = true;
      await new Promise<void>((resolve) => {
        probe.release = resolve;
      });
      return new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  }, devices[0].id);
  await a
    .getByRole("textbox", { name: "Command for Device 1", exact: true })
    .fill("old-device-command");
  await a
    .getByRole("button", { name: "Send to mock:multi-0", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __serialhubDelayedWrite: { started: boolean } })
            .__serialhubDelayedWrite.started,
      ),
    )
    .toBe(true);
  await request.delete(`/manager/sessions/${devices[0].id}`);
  await expect(a).toHaveCount(0);
  await request.post("/manager/sessions", {
    data: { path: devices[0].path, name: devices[0].name, settings },
  });
  await expect(a).toHaveCount(1);
  await page.evaluate(() =>
    (
      window as Window & { __serialhubDelayedWrite: { release: () => void } }
    ).__serialhubDelayedWrite.release(),
  );
  await expect(
    a.getByRole("textbox", { name: "Command for Device 1", exact: true }),
  ).toHaveValue("");
  await expect(a.locator(".port-entry.tx")).toHaveCount(0);
  await expect(b.locator(".port-state")).toHaveText("Receiving");
});

test("multi-port layouts fit desktop translations and keep narrow-screen controls reachable", async ({
  page,
  request,
}) => {
  await create(request, 6);
  await enter(page, 6);
  for (const locale of ["en", "zh-Hant", "es", "fr", "ar"] as Locale[]) {
    await page
      .locator(".multi-toolbar .language-selector select")
      .selectOption(locale);
    for (const width of [1280, 1366]) {
      await page.setViewportSize({ width, height: 768 });
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollHeight <= innerHeight &&
            document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      for (const card of await page.locator(".port-panel:visible").all()) {
        const box = await card.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(box!.y + box!.height).toBeLessThanOrEqual(768);
        expect(
          await card.locator(".port-log").evaluate((node) => node.clientHeight),
        ).toBeGreaterThan(45);
        await expect(
          card.getByRole("button", {
            name: translate(locale, "Send to {p0}", {
              p0: (await card.getAttribute("data-device")) ?? "",
            }),
            exact: true,
          }),
        ).toBeVisible();
      }
    }
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page
    .getByRole("combobox", { name: translate("ar", "Layout"), exact: true })
    .selectOption("columns");
  await page
    .getByRole("spinbutton", { name: translate("ar", "Columns"), exact: true })
    .fill("3");
  await expect(page.locator(".port-panel:visible")).toHaveCount(6);
  await page
    .getByRole("combobox", { name: translate("ar", "Layout"), exact: true })
    .selectOption("auto");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".port-panel:visible").last().scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.locator(".port-panel:visible").last().locator("textarea"),
  ).toBeVisible();
});

test("closing a panel requires confirmation and does not close the other devices", async ({
  page,
  request,
}) => {
  const devices = await create(request);
  await enter(page);
  const a = panel(page, devices[0].path),
    b = panel(page, devices[1].path);
  await a.getByLabel("Panel tools", { exact: true }).click();
  await a.getByRole("button", { name: "Close session", exact: true }).click();
  await expect(
    a.getByRole("button", { name: "Confirm close", exact: true }),
  ).toBeVisible();
  await a.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    (await (await request.get("/manager/info")).json()).sessions,
  ).toHaveLength(4);
  await a.getByRole("button", { name: "Close session", exact: true }).click();
  await a.getByRole("button", { name: "Confirm close", exact: true }).click();
  await expect(a).toHaveCount(0);
  await expect(b.locator(".port-state")).toHaveText("Receiving");
  await page.setViewportSize({ width: 1366, height: 600 });
  await expect(page.locator(".port-panel:visible")).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
});

test("seventeen ports exceed the old cap and keep bounded independent tiled logs", async ({
  page,
  request,
}) => {
  const devices = await create(request, 17);
  await enter(page, 17);
  const first = panel(page, devices[0].path);
  await first
    .getByRole("textbox", { name: "Command for Device 1", exact: true })
    .fill("draft-at-capacity");
  for (let port = 0; port < devices.length; port++) {
    const text = Array.from(
      { length: 513 },
      (_, sequence) =>
        `port-${port} sequence=${String(sequence).padStart(4, "0")}\n`,
    ).join("");
    const response = await request.post(
      `/sessions/${devices[port].id}/v1/write`,
      { data: { text, newline: false } },
    );
    expect((await response.json()).ok).toBe(true);
  }
  await expect(first.locator(".port-entry.rx")).toHaveCount(400);
  const last = panel(page, devices[16].path);
  await expect(last.locator(".port-entry.rx")).toHaveCount(400);
  await expect(last.locator(".port-entry.rx").last()).toContainText(
    "port-16 sequence=0512",
  );
  await expect(
    last.locator(".port-entry.rx").filter({ hasText: "port-0 sequence=" }),
  ).toHaveCount(0);
  await expect(
    first.getByRole("textbox", { name: "Command for Device 1", exact: true }),
  ).toHaveValue("draft-at-capacity");
  const info = await (await request.get("/manager/info")).json();
  expect(info.sessions).toHaveLength(17);
  expect(
    info.sessions.every(
      (session: { clients: number }) => session.clients === 1,
    ),
  ).toBe(true);
});

test("automatic tiling grows from one to six panes, allows custom tracks and drag resizing", async ({
  page,
  request,
}) => {
  const devices = await create(request, 1);
  await enter(page, 1);
  const grid = page.locator(".multi-grid");
  const expected = [
    [1, 1],
    [1, 2],
    [2, 2],
    [2, 2],
    [2, 3],
    [2, 3],
  ];
  for (let count = 1; count <= 6; count++) {
    if (count > 1) {
      const path = `mock:dynamic-${count}`;
      const result = await request.post("/manager/sessions", {
        data: { path, name: `Extra ${count}`, settings },
      });
      devices.push({ ...(await result.json()), path, name: `Extra ${count}` });
    }
    await expect(page.locator(".port-panel:visible")).toHaveCount(count);
    await expect(grid).toHaveAttribute(
      "data-rows",
      String(expected[count - 1][0]),
    );
    await expect(grid).toHaveAttribute(
      "data-columns",
      String(expected[count - 1][1]),
    );
  }
  await page
    .getByRole("combobox", { name: "Layout", exact: true })
    .selectOption("rows");
  await page.getByRole("spinbutton", { name: "Rows", exact: true }).fill("3");
  await expect(grid).toHaveAttribute("data-rows", "3");
  await expect(grid).toHaveAttribute("data-columns", "2");
  await page
    .getByRole("combobox", { name: "Layout", exact: true })
    .selectOption("columns");
  await page
    .getByRole("spinbutton", { name: "Columns", exact: true })
    .fill("3");
  await expect(grid).toHaveAttribute("data-columns", "3");
  const first = page.locator(".port-panel:visible").first();
  const original = (await first.boundingBox())!.width;
  const divider = page
    .getByRole("separator", { name: "Resize columns", exact: true })
    .first();
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 80);
  await page.mouse.up();
  expect((await first.boundingBox())!.width).toBeGreaterThan(original + 35);
  await divider.focus();
  await divider.press("Home");
  expect(Math.abs((await first.boundingBox())!.width - original)).toBeLessThan(
    2,
  );
  await divider.press("ArrowRight");
  expect((await first.boundingBox())!.width).toBeGreaterThan(original + 15);
  await page.reload();
  await page
    .getByRole("tab", { name: "Multi-port workspace", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Layout", exact: true }),
  ).toHaveValue("columns");
  await expect(
    page.getByRole("spinbutton", { name: "Columns", exact: true }),
  ).toHaveValue("3");
  await request.delete(`/manager/sessions/${devices[0].id}`);
  await expect(page.locator(".port-panel:visible")).toHaveCount(5);
});

test("HTTP and a second WebSocket share one physical owner alongside the tiled UI", async ({
  page,
  request,
}) => {
  const devices = await create(request, 2);
  await enter(page, 2);
  const received: string[] = [];
  const socket = new WebSocket(
    `ws://127.0.0.1:18889/sessions/${devices[0].id}/v1/stream`,
  );
  socket.binaryType = "arraybuffer";
  socket.addEventListener("message", (event) => {
    if (event.data instanceof ArrayBuffer)
      received.push(new TextDecoder().decode(event.data));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    socket.send(new TextEncoder().encode("from-ws-client\n"));
    const response = await request.post(`/sessions/${devices[0].id}/v1/write`, {
      data: { text: "from-http-client", newline: true },
    });
    expect((await response.json()).ok).toBe(true);
    const a = panel(page, devices[0].path),
      b = panel(page, devices[1].path);
    await a.locator("textarea").fill("from-ui-client");
    await a
      .getByRole("button", { name: `Send to ${devices[0].path}`, exact: true })
      .click();
    await expect(a.locator(".port-entry.rx")).toContainText([
      "from-ws-client",
      "from-http-client",
      "from-ui-client",
    ]);
    await expect.poll(() => received.join("")).toContain("from-ui-client");
    expect(received.join("")).toContain("from-ws-client");
    expect(received.join("")).toContain("from-http-client");
    await expect(b.locator(".port-entry.rx")).toHaveCount(0);
    const info = await (await request.get("/manager/info")).json();
    expect(info.sessions).toHaveLength(2);
    expect(
      info.sessions.find((s: { id: string }) => s.id === devices[0].id).clients,
    ).toBe(2);
    const status = await (
      await request.get(`/sessions/${devices[0].id}/v1/status`)
    ).json();
    expect(status.stats.tx_bytes).toBe(
      "from-ws-client\nfrom-http-client\nfrom-ui-client\n".length,
    );
  } finally {
    socket.close();
  }
});
