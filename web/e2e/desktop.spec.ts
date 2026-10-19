import { test, expect, type Page } from "@playwright/test";
import { translate, type MessageKey } from "../src/i18n/index";
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
    .getByPlaceholder("e.g. AT or a device command")
    .fill("unsent-alpha-draft");
  await workspace
    .getByRole("button", { name: "Connections", exact: true })
    .click();
  await expect(
    workspace
      .locator("td code")
      .filter({ hasText: /^ws:\/\/127\.0\.0\.1:18889\/sessions\// }),
  ).toBeVisible();
  await page
    .locator(".managed-workspace:not([hidden]) .workspace-device-switch select")
    .selectOption("");
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
  await page
    .getByRole("combobox", { name: "Device sessions", exact: true })
    .selectOption({ label: "Sensor A" });
  await expect(
    workspace
      .getByRole("navigation")
      .getByRole("button", { name: "Connections", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await workspace
    .getByRole("button", { name: "Live console", exact: true })
    .click();
  await expect(
    workspace.locator(".line.rx").filter({ hasText: "alpha-only" }),
  ).toBeVisible();
  await expect(
    workspace.locator(".line.rx").filter({ hasText: "beta-only" }),
  ).toHaveCount(0);
  await expect(
    workspace.getByPlaceholder("e.g. AT or a device command"),
  ).toHaveValue("unsent-alpha-draft");
  const info = await (await page.request.get("/manager/info")).json();
  expect(info.sessions.map((s: { clients: number }) => s.clients)).toEqual([
    1, 1,
  ]);
  await page
    .locator(".managed-workspace:not([hidden]) .workspace-device-switch select")
    .selectOption("");
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
  await page
    .locator(".managed-workspace:not([hidden]) .workspace-device-switch select")
    .selectOption("");
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
    // A genuine cross-site navigation (localhost and 127.0.0.1 are different
    // sites) must open the public UI, then pair through same-origin JSON.
    await remote.route("http://localhost:18887/shared-link", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<a href="${link.href}">Open shared devices</a>`,
      }),
    );
    await remote.goto("http://localhost:18887/shared-link");
    await remote.getByRole("link", { name: "Open shared devices" }).click();
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
  for (const width of [390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".manager-toolbar")).toBeHidden();
    await expect(page.locator(".language-selector:visible")).toHaveCount(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    const active = page.locator(".managed-workspace:not([hidden])");
    for (const name of [
      "Live console",
      "Signal studio",
      "Events & metrics",
      "Connections",
      "User guide",
    ]) {
      await active
        .getByRole("navigation")
        .getByRole("button", { name, exact: true })
        .click();
      await expect(active.locator(".connect")).toHaveCount(0);
    }
  }
  await page
    .getByRole("combobox", { name: "Device sessions", exact: true })
    .selectOption("");
  await expect(page.locator(".manager-dashboard")).toBeVisible();
});

test("mounted workspaces own their keyboard focus and SVG clipping identifiers", async ({
  page,
}) => {
  await page.goto("/");
  await open(page, "Keyboard A", "mock:keyboard-a");
  await page
    .locator(".managed-workspace:not([hidden]) .workspace-device-switch select")
    .selectOption("");
  await open(page, "Keyboard B", "mock:keyboard-b");
  const active = page.locator(".managed-workspace:not([hidden])");
  const dock = active.locator(".dock-tabs [role=tab]");
  await dock.first().focus();
  await dock.first().press("ArrowRight");
  await expect(dock.nth(1)).toBeFocused();
  await active
    .getByRole("button", { name: "Signal studio", exact: true })
    .click();
  const analysis = active.locator(".analysis-tabs [role=tab]");
  await analysis.first().focus();
  await analysis.first().press("ArrowRight");
  await expect(analysis.nth(1)).toBeFocused();
  const ids = await page
    .locator("[id]")
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(ids).size).toBe(ids.length);
  for (const svg of await page.locator("svg:has(clipPath)").all()) {
    const references = await svg
      .locator("[clip-path]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("clip-path")),
      );
    const definitions = await svg
      .locator("clipPath[id]")
      .evaluateAll((nodes) => nodes.map((node) => node.id));
    for (const reference of references)
      expect(definitions).toContain(reference!.slice(5, -1));
  }
});

for (const locale of ["en", "zh-Hant", "es", "fr", "ar"] as const) {
  test(`one workbench header keeps navigation and device controls usable: ${locale}`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try demo", exact: true }).click();
    const active = page.locator(".managed-workspace:not([hidden])");
    await expect(active.locator(".lamp")).toContainText("HTTP + WS");
    await active.locator(".language-selector select").selectOption(locale);
    const label = (key: MessageKey) => translate(locale, key);
    for (const width of [1280, 1366, 2048]) {
      await page.setViewportSize({ width, height: 768 });
      for (const key of [
        "Live console",
        "Signal studio",
        "Events & metrics",
        "Connections",
        "User guide",
      ] as const) {
        await active
          .getByRole("navigation")
          .getByRole("button", { name: label(key), exact: true })
          .click();
        await expect(page.locator(".manager-toolbar")).toBeHidden();
        await expect(
          page.locator(".brand:visible, .manager-brand:visible"),
        ).toHaveCount(1);
        await expect(page.locator(".language-selector:visible")).toHaveCount(1);
        await expect(active.locator(".connect")).toHaveCount(0);
        const geometry = await active.locator(".sidebar").evaluate((bar) => {
          const nav = bar.querySelector("nav")!;
          const controls = bar.querySelector(".workspace-controls")!;
          const n = nav.getBoundingClientRect(),
            c = controls.getBoundingClientRect(),
            h = bar.getBoundingClientRect();
          return {
            fits:
              document.documentElement.scrollWidth <= innerWidth &&
              document.documentElement.scrollHeight <= innerHeight,
            oneRow:
              h.height <= 50 &&
              Math.abs(n.top + n.height / 2 - c.top - c.height / 2) < 2,
            separate: n.right <= c.left + 1 || c.right <= n.left + 1,
            labels: Array.from(nav.querySelectorAll("button span")).every(
              (text) => text.scrollWidth <= text.clientWidth + 1,
            ),
            inside: [...bar.querySelectorAll("button, select, .lamp")].every(
              (item) => {
                const r = item.getBoundingClientRect();
                return (
                  r.left >= h.left &&
                  r.right <= h.right &&
                  r.top >= h.top &&
                  r.bottom <= h.bottom
                );
              },
            ),
          };
        });
        expect(geometry, `${locale} ${width} ${key}`).toEqual({
          fits: true,
          oneRow: true,
          separate: true,
          labels: true,
          inside: true,
        });
      }
    }
    await active
      .getByRole("combobox", { name: label("Device sessions"), exact: true })
      .selectOption("");
    await expect(page.locator(".manager-dashboard")).toBeVisible();
    await expect(page.locator(".language-selector:visible")).toHaveCount(1);
    await page.locator(".manager-tabs [role=tab]").last().click();
    await expect(
      active.getByRole("button", { name: label("User guide"), exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(active.locator(".lamp")).toContainText("HTTP + WS");
  });
}
