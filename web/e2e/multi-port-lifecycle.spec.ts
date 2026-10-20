import { test, expect } from "@playwright/test";

test.use({
  baseURL: "http://127.0.0.1:18889",
  viewport: { width: 1366, height: 768 },
});
test.beforeEach(async ({ page, request }) => {
  await page.addInitScript(() =>
    localStorage.setItem("serialhub.ui.locale.v1", "en"),
  );
  await request.delete("/manager/lan");
  const info = await (await request.get("/manager/info")).json();
  for (const session of info.sessions)
    await request.delete(`/manager/sessions/${session.id}`);
});

const settings = {
  baud: 115200,
  databits: 8,
  parity: "none",
  stopbits: 1,
  flow: "none",
};

test("an epoch change cancels that panel's pending send while other ports remain usable", async ({
  page,
  request,
}) => {
  const ids: string[] = [];
  for (const name of ["A", "B"]) {
    const response = await request.post("/manager/sessions", {
      data: { name, path: `mock:gate-${name}`, settings },
    });
    expect(response.ok()).toBe(true);
    ids.push((await response.json()).id);
  }
  let epoch = 30;
  await page.route(`**/sessions/${ids[0]}/v1/status`, async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    status.port.epoch = epoch;
    await route.fulfill({ json: status });
  });
  let releaseOld!: () => void;
  let releaseNew!: () => void;
  const oldAck = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const newAck = new Promise<void>((resolve) => {
    releaseNew = resolve;
  });
  let writes = 0;
  await page.route(`**/sessions/${ids[0]}/v1/write`, async (route) => {
    const index = ++writes;
    await (index === 1 ? oldAck : newAck);
    await route.fulfill({ json: { ok: true, bytes: 4 } }).catch(() => {});
  });
  await page.goto("/");
  await page
    .getByRole("tab", { name: "Multi-port workspace", exact: true })
    .click();
  const a = page.locator('.port-panel[data-device="mock:gate-A"]');
  const b = page.locator('.port-panel[data-device="mock:gate-B"]');
  await expect(a.locator(".port-state")).toHaveText("Receiving");
  await expect(b.locator(".port-state")).toHaveText("Receiving");
  const send = a.getByRole("button", {
    name: "Send to mock:gate-A",
    exact: true,
  });
  const editor = a.getByRole("textbox", { name: "Command for A", exact: true });
  try {
    await editor.fill("old");
    await send.click();
    await expect.poll(() => writes).toBe(1);
    await b
      .getByRole("textbox", { name: "Command for B", exact: true })
      .fill("other-port");
    await b
      .getByRole("button", { name: "Send to mock:gate-B", exact: true })
      .click();
    await expect(b.locator(".port-entry.tx")).toContainText("other-port");
    epoch = 31;
    await expect(send).toBeEnabled();
    await editor.fill("new");
    await send.click();
    await expect.poll(() => writes).toBe(2);
    releaseOld();
    await expect(send).toBeDisabled();
    await expect(a.locator(".port-entry.tx")).toHaveCount(0);
    releaseNew();
    await expect(a.locator(".port-entry.tx")).toHaveCount(1);
    await expect(a.locator(".port-entry.tx")).toContainText("new");
    expect(writes).toBe(2);
  } finally {
    releaseOld();
    releaseNew();
  }
});

test("partial HTTP ACKs are errors and do not create a successful TX entry", async ({
  page,
  request,
}) => {
  const response = await request.post("/manager/sessions", {
    data: { name: "Partial", path: "mock:partial-ack", settings },
  });
  expect(response.ok()).toBe(true);
  const id = (await response.json()).id;
  await page.route(`**/sessions/${id}/v1/write`, (route) =>
    route.fulfill({ json: { ok: true, bytes: 1 } }),
  );
  await page.goto("/");
  await page
    .getByRole("tab", { name: "Multi-port workspace", exact: true })
    .click();
  const panel = page.locator('.port-panel[data-device="mock:partial-ack"]');
  await expect(panel.locator(".port-state")).toHaveText("Receiving");
  await panel
    .getByRole("textbox", { name: "Command for Partial", exact: true })
    .fill("partial");
  const send = panel.getByRole("button", {
    name: "Send to mock:partial-ack",
    exact: true,
  });
  await send.click();
  await expect(panel.locator(".port-entry.err")).toContainText(
    "Write length not fully acknowledged",
  );
  await expect(panel.locator(".port-entry.tx")).toHaveCount(0);
  await expect(send).toBeEnabled();
});
