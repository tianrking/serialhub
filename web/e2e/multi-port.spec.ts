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
async function enter(page: Page) {
  await page.goto("/");
  await page
    .getByRole("tab", { name: "Multi-port workspace", exact: true })
    .click();
  await expect(page.locator(".port-panel:visible .port-state")).toHaveText(
    Array.from({ length: 4 }, () => "Receiving"),
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
  expect(
    await page.locator(".manager-brand:visible, .app .brand:visible").count(),
  ).toBe(1);
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
    expect(box!.y + box!.height).toBeLessThan(768);
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

test("pagination and full-workspace switching retain drafts and hidden-panel acquisition", async ({
  page,
  request,
}) => {
  const devices = await create(request, 6);
  await enter(page);
  const a = panel(page, devices[0].path),
    last = panel(page, devices[5].path);
  await a
    .getByRole("textbox", { name: "Command for Device 1", exact: true })
    .fill("keep-this-draft");
  await request.post(`/sessions/${devices[5].id}/v1/write`, {
    data: { text: "background-panel-data" },
  });
  await page.getByRole("button", { name: "Next panels", exact: true }).click();
  await expect(last).toBeVisible();
  await expect(last.locator(".port-entry.rx")).toContainText([
    "background-panel-data",
  ]);
  await page
    .getByRole("button", { name: "Previous panels", exact: true })
    .click();
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
  await expect(page.locator(".port-panel:visible")).toHaveCount(4);
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
  let started = false,
    release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/sessions/${devices[0].id}/v1/write`, async (route) => {
    const response = await route.fetch();
    started = true;
    await held;
    await route.fulfill({ response }).catch(() => {});
  });
  await a
    .getByRole("textbox", { name: "Command for Device 1", exact: true })
    .fill("old-device-command");
  await a
    .getByRole("button", { name: "Send to mock:multi-0", exact: true })
    .click();
  await expect.poll(() => started).toBe(true);
  await request.delete(`/manager/sessions/${devices[0].id}`);
  await expect(a).toHaveCount(0);
  await request.post("/manager/sessions", {
    data: { path: devices[0].path, name: devices[0].name, settings },
  });
  await expect(a).toHaveCount(1);
  release();
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
  await enter(page);
  for (const locale of ["en", "zh-Hant", "es", "fr", "ar"] as Locale[]) {
    await page
      .locator(".manager-toolbar .language-selector select")
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
        expect(box!.y + box!.height).toBeLessThan(768);
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
  await page.locator(".multi-controls select").selectOption("6");
  await expect(page.locator(".port-panel:visible")).toHaveCount(6);
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
  await expect(page.locator(".port-panel:visible")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
});

test("sixteen ports keep bounded independent recent logs while paging", async ({
  page,
  request,
}) => {
  const devices = await create(request, 16);
  await enter(page);
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
  for (let pageIndex = 0; pageIndex < 3; pageIndex++)
    await page
      .getByRole("button", { name: "Next panels", exact: true })
      .click();
  const last = panel(page, devices[15].path);
  await expect(last.locator(".port-entry.rx")).toHaveCount(400);
  await expect(last.locator(".port-entry.rx").last()).toContainText(
    "port-15 sequence=0512",
  );
  await expect(
    last.locator(".port-entry.rx").filter({ hasText: "port-0 sequence=" }),
  ).toHaveCount(0);
  for (let pageIndex = 0; pageIndex < 3; pageIndex++)
    await page
      .getByRole("button", { name: "Previous panels", exact: true })
      .click();
  await expect(
    first.getByRole("textbox", { name: "Command for Device 1", exact: true }),
  ).toHaveValue("draft-at-capacity");
  const info = await (await request.get("/manager/info")).json();
  expect(info.sessions).toHaveLength(16);
  expect(
    info.sessions.every(
      (session: { clients: number }) => session.clients === 1,
    ),
  ).toBe(true);
});
