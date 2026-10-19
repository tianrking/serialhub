import { test, expect, type Page } from "@playwright/test";
test.use({
  baseURL: "http://127.0.0.1:18889",
  viewport: { width: 1366, height: 768 },
});
test.beforeEach(async ({ request }) => {
  const info = await (await request.get("/manager/info")).json();
  for (const session of info.sessions)
    await request.delete(`/manager/sessions/${session.id}`);
  await request.delete("/manager/lan");
});
async function open(page: Page, name: string, path: string) {
  await page.getByLabel("Device path", { exact: true }).fill(path);
  await page.getByLabel("Session name", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.locator(".managed-workspace:not([hidden]) .lamp"),
  ).toContainText("HTTP + WS");
}
test("no-command dashboard opens two independent workspaces and preserves their connections", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your devices. One workspace." }),
  ).toBeVisible();
  await open(page, "Sensor A", "mock:e2e-a");
  const workspace = page.locator(".managed-workspace:not([hidden])");
  await workspace
    .getByPlaceholder("e.g. AT or a device command")
    .fill("alpha-only");
  await workspace
    .getByRole("button", { name: "Send text", exact: true })
    .click();
  await expect(
    workspace.locator(".line.rx").filter({ hasText: "alpha-only" }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await expect(
    workspace
      .locator("td code")
      .filter({ hasText: /^ws:\/\/127\.0\.0\.1:18889\/sessions\// }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /All devices/ }).click();
  await open(page, "Sensor B", "mock:e2e-b");
  await workspace
    .getByPlaceholder("e.g. AT or a device command")
    .fill("beta-only");
  await workspace
    .getByRole("button", { name: "Send text", exact: true })
    .click();
  await expect(
    workspace.locator(".line.rx").filter({ hasText: "beta-only" }),
  ).toBeVisible();
  await expect(
    workspace.locator(".line.rx").filter({ hasText: "alpha-only" }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Sensor A", exact: true }).click();
  await workspace
    .getByRole("button", { name: "Live console", exact: true })
    .click();
  await expect(
    workspace.locator(".line.rx").filter({ hasText: "alpha-only" }),
  ).toBeVisible();
  await expect(
    workspace.locator(".line.rx").filter({ hasText: "beta-only" }),
  ).toHaveCount(0);
  const info = await (await page.request.get("/manager/info")).json();
  expect(info.sessions.map((s: { clients: number }) => s.clients)).toEqual([
    1, 1,
  ]);
  await page.getByRole("tab", { name: /All devices/ }).click();
  await expect(page.locator(".manager-session")).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  await page
    .locator(".manager-session")
    .filter({ hasText: "Sensor A" })
    .getByRole("button", { name: "Close session", exact: true })
    .click();
  await page
    .locator(".manager-session")
    .filter({ hasText: "Sensor A" })
    .getByRole("button", { name: "Close session", exact: true })
    .click();
  await expect(page.locator(".manager-session")).toHaveCount(1);
  await page.getByRole("tab", { name: "Sensor B", exact: true }).click();
  await expect(workspace.locator(".lamp")).toContainText("HTTP + WS");
  expect(errors).toEqual([]);
});
test("LAN link pairs another browser, retains cookie access, and revokes open sockets", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try demo", exact: true }).click();
  await expect(
    page.locator(".managed-workspace:not([hidden]) .lamp"),
  ).toContainText("HTTP + WS");
  await page.getByRole("tab", { name: /All devices/ }).click();
  await page
    .getByRole("button", { name: "Enable LAN sharing", exact: true })
    .click();
  const linkInput = page.getByLabel("Pairing link", { exact: true });
  await expect(linkInput).toBeVisible();
  const link = new URL(await linkInput.inputValue());
  // Exercise the LAN listener on loopback too, independent of CI routing.
  link.hostname = "127.0.0.1";
  const context = await browser.newContext();
  const remote = await context.newPage();
  try {
    await remote.goto(link.origin);
    await expect(
      remote.getByRole("heading", { name: "Pair this browser" }),
    ).toBeVisible();
    await remote.goto(link.href);
    await expect(
      remote.getByRole("heading", { name: "Your devices. One workspace." }),
    ).toBeVisible();
    expect(new URL(remote.url()).hash).toBe("");
    await remote.reload();
    await expect(
      remote.getByText("Paired browser", { exact: true }),
    ).toBeVisible();
    await remote
      .locator(".manager-session")
      .getByRole("button", { name: /Open workspace/ })
      .click();
    await expect(
      remote.locator(".managed-workspace:not([hidden]) .lamp"),
    ).toContainText("HTTP + WS");
    await page
      .getByRole("button", { name: "Disable LAN sharing", exact: true })
      .click();
    await expect(
      remote.locator(".managed-workspace:not([hidden]) .lamp"),
    ).not.toContainText("HTTP + WS");
    await expect(
      page.getByText("Local access only", { exact: false }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
for (const [locale, heading] of [
  ["zh-Hant", "多個裝置，一個工作區。"],
  ["es", "Tus dispositivos. Un espacio."],
  ["fr", "Vos appareils. Un espace."],
  ["ar", "أجهزتك. مساحة عمل واحدة."],
] as const) {
  test(`manager is localized and fits the desktop viewport: ${locale}`, async ({
    page,
  }) => {
    await page.addInitScript(
      (locale) => localStorage.setItem("serialhub.ui.locale.v1", locale),
      locale,
    );
    await page.goto("/");
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    expect(
      await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      })),
    ).toEqual({ width: 1366, height: 768 });
    if (locale === "ar")
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
}
test("demo and manager remain usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your devices. One workspace." }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.getByRole("button", { name: "Try demo", exact: true }).click();
  await expect(
    page.locator(".managed-workspace:not([hidden]) .lamp"),
  ).toContainText("HTTP + WS");
});
