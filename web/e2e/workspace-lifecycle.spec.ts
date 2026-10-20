import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("serialhub.ui.locale.v1", "en"),
  );
});

test("a new device epoch cancels an old command and its late ACK cannot unlock a newer command", async ({
  page,
}) => {
  let epoch = 10;
  await page.route("**/v1/status", async (route) => {
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
  await page.route("**/v1/write", async (route) => {
    const index = ++writes;
    await (index === 1 ? oldAck : newAck);
    await route.fulfill({ json: { ok: true, bytes: 4 } }).catch(() => {});
  });
  await page.goto("/");
  const editor = page.getByPlaceholder("e.g. AT or a device command");
  await editor.fill("old");
  await page
    .getByRole("button", { name: "Connect to Hub", exact: true })
    .click();
  await expect(page.locator(".lamp")).toContainText("HTTP + WS");
  const send = page.getByRole("button", { name: "Send text", exact: true });
  try {
    await send.click();
    await expect.poll(() => writes).toBe(1);
    await expect(send).toBeDisabled();
    epoch = 11;
    await expect(send).toBeEnabled();
    await editor.fill("new");
    await send.click();
    await expect.poll(() => writes).toBe(2);
    releaseOld();
    await expect(send).toBeDisabled();
    await expect(page.locator(".line.tx")).toHaveCount(0);
    releaseNew();
    await expect(page.locator(".line.tx")).toHaveCount(1);
    await expect(page.locator(".line.tx")).toContainText("new");
    await expect(send).toBeEnabled();
    await expect(page.locator(".line.err")).toContainText(
      "in-flight operation may have reached the device",
    );
    expect(writes).toBe(2);
  } finally {
    releaseOld();
    releaseNew();
  }
});

test("scheduled sends stop on a device epoch change even when HTTP and WS stay connected", async ({
  page,
}) => {
  let epoch = 20;
  await page.route("**/v1/status", async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    status.port.epoch = epoch;
    await route.fulfill({ json: status });
  });
  let writes = 0;
  await page.route("**/v1/write", (route) => {
    writes++;
    return route.fulfill({ json: { ok: true, bytes: 5 } });
  });
  await page.goto("/");
  await page.getByPlaceholder("e.g. AT or a device command").fill("auto");
  await page
    .getByRole("button", { name: "Connect to Hub", exact: true })
    .click();
  await expect(page.locator(".lamp")).toContainText("HTTP + WS");
  await page.locator(".auto-send-settings summary").click();
  await page.locator(".auto-send-settings input[type=number]").fill("50");
  const repeat = page.getByRole("checkbox", { name: "Repeat current content" });
  await repeat.check();
  await expect.poll(() => writes).toBeGreaterThan(0);
  epoch = 21;
  await expect(repeat).not.toBeChecked();
  await expect(page.locator(".lamp")).toContainText("HTTP + WS");
  const stopped = writes;
  // Three configured timer intervals must pass without a resumed write.
  await page.waitForTimeout(150);
  expect(writes).toBe(stopped);
});

test("a malformed device epoch fails closed before a send can be admitted", async ({
  page,
}) => {
  await page.route("**/v1/status", async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    status.port.epoch = Number.MAX_SAFE_INTEGER + 1;
    await route.fulfill({ json: status });
  });
  await page.goto("/");
  await page.getByPlaceholder("e.g. AT or a device command").fill("never-send");
  await page
    .getByRole("button", { name: "Connect to Hub", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Incompatible status data",
  );
  await expect(
    page.getByRole("button", { name: "Send text", exact: true }),
  ).toBeDisabled();
});
