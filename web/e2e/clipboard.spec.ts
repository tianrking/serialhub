import { test, expect, type Page } from "@playwright/test";

test.use({ viewport: { width: 1366, height: 768 } });
async function connect(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect to Hub", exact: true })
    .click();
  await expect(page.locator(".lamp")).toContainText("HTTP + WS");
}
async function clipboard(page: Page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

test("copying filtered text and HEX preserves displayed payloads and never transmits", async ({
  page,
  context,
  request,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:18887",
  });
  await connect(page);
  const marker = `copy-板子-🙂-${Date.now()}`;
  await request.post("/v1/write", { data: { text: marker } });
  await request.post("/v1/write", { data: { text: "exclude-from-copy" } });
  await page.getByLabel("Search terminal log", { exact: true }).fill(marker);
  const row = page.locator(".line.rx");
  await expect(row).toHaveCount(1);
  const payload = await row.locator(".msg").textContent();
  const before = (await (await request.get("/v1/status")).json()).stats
    .tx_bytes;
  await page.getByLabel("Display", { exact: true }).selectOption("text");
  await page.getByRole("button", { name: "Copy log", exact: true }).click();
  await expect.poll(() => clipboard(page)).toContain(marker);
  expect(await clipboard(page)).not.toContain("exclude-from-copy");
  await row.hover();
  await row.getByRole("button", { name: "Copy payload", exact: true }).click();
  await expect.poll(() => clipboard(page)).toBe(payload);
  await page.getByLabel("Display", { exact: true }).selectOption("hex");
  const hex = await row.locator(".hex").textContent();
  await row.hover();
  await row.getByRole("button", { name: "Copy payload", exact: true }).click();
  await expect.poll(() => clipboard(page)).toBe(hex);
  expect((await (await request.get("/v1/status")).json()).stats.tx_bytes).toBe(
    before,
  );
});

test("HTTP clipboard fallback restores the active draft, caret and temporary DOM", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    document.execCommand = (command: string) => {
      const field = document.activeElement as HTMLTextAreaElement;
      Object.assign(window, {
        __copied:
          command === "copy"
            ? field.value.slice(field.selectionStart, field.selectionEnd)
            : "",
      });
      return command === "copy";
    };
  });
  await connect(page);
  await request.post("/v1/write", { data: { text: "fallback-proof" } });
  await page
    .getByLabel("Search terminal log", { exact: true })
    .fill("fallback-proof");
  await expect(page.locator(".line.rx")).toHaveCount(1);
  const draft = page.locator(".composer-panel textarea").first();
  await draft.fill("keep-this-draft");
  await draft.focus();
  await draft.evaluate((node: HTMLTextAreaElement) =>
    node.setSelectionRange(2, 6),
  );
  await page
    .getByRole("button", { name: "Copy log", exact: true })
    .evaluate((node: HTMLButtonElement) => node.click());
  await expect(page.locator(".clipboard-notice")).toHaveText("Copied");
  expect(
    await page.evaluate(
      () => (window as Window & { __copied: string }).__copied,
    ),
  ).toContain("fallback-proof");
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue("keep-this-draft");
  expect(
    await draft.evaluate((node: HTMLTextAreaElement) => [
      node.selectionStart,
      node.selectionEnd,
    ]),
  ).toEqual([2, 6]);
  await expect(page.locator('textarea[aria-hidden="true"]')).toHaveCount(0);
});

test("clipboard denial offers selectable manual text, contains focus and does not send", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    document.execCommand = () => false;
  });
  await connect(page);
  await request.post("/v1/write", { data: { text: "manual-copy-proof" } });
  await page
    .getByLabel("Search terminal log", { exact: true })
    .fill("manual-copy-proof");
  await expect(page.locator(".line.rx")).toHaveCount(1);
  const before = (await (await request.get("/v1/status")).json()).stats
    .tx_bytes;
  const copy = page.getByRole("button", { name: "Copy log", exact: true });
  await copy.click();
  const dialog = page.getByRole("dialog", {
    name: "Copy manually",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const text = dialog.getByRole("textbox", {
    name: "Text to copy",
    exact: true,
  });
  await expect(text).toContainText("manual-copy-proof");
  await expect(text).toBeFocused();
  await dialog
    .getByRole("button", { name: "Select text", exact: true })
    .click();
  expect(
    await text.evaluate(
      (node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart,
    ),
  ).toBe((await text.inputValue()).length);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(copy).toBeFocused();
  expect((await (await request.get("/v1/status")).json()).stats.tx_bytes).toBe(
    before,
  );
});

test("tool conversion, filtered events, metrics and guide addresses copy independently", async ({
  page,
  context,
  request,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:18887",
  });
  await connect(page);
  await page.getByRole("tab", { name: "Toolkit", exact: true }).click();
  await page.getByRole("tab", { name: "Encoding", exact: true }).click();
  await page.getByLabel("Conversion input", { exact: true }).fill("AT");
  await page.getByRole("button", { name: "Text → HEX", exact: true }).click();
  await page.getByRole("button", { name: "Copy result", exact: true }).click();
  await expect.poll(() => clipboard(page)).toBe("41 54");
  await request.post("/v1/write", {
    data: { text: "copy-events", as_client: "copy-test" },
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Events & metrics", exact: true })
    .click();
  await expect(page.locator(".metric-card").first()).toBeVisible();
  await page.getByRole("button", { name: "Copy metrics", exact: true }).click();
  await expect.poll(() => clipboard(page)).toContain("# HELP");
  await page.getByLabel("Actor", { exact: true }).fill("copy-test");
  await expect(
    page.getByRole("button", { name: "Copy events", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Copy events", exact: true }).click();
  const events = (await clipboard(page))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  expect(events.length).toBeGreaterThan(0);
  expect(events.every((event) => event.payload.actor === "copy-test")).toBe(
    true,
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "User guide", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Copy API address", exact: true })
    .click();
  await expect.poll(() => clipboard(page)).toBe("http://127.0.0.1:18887");
  await page
    .getByRole("button", { name: "Copy stream address", exact: true })
    .click();
  await expect
    .poll(() => clipboard(page))
    .toBe("ws://127.0.0.1:18887/v1/stream");
});

test("multi-port copy respects its panel, filter and paused snapshot while reception continues", async ({
  page,
  context,
  playwright,
}) => {
  const api = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:18889",
  });
  const devices: { id: string; path: string }[] = [];
  try {
    const info = await (await api.get("/manager/info")).json();
    for (const session of info.sessions)
      await api.delete(`/manager/sessions/${session.id}`);
    for (let i = 0; i < 2; i++) {
      const response = await api.post("/manager/sessions", {
        data: {
          path: `mock:copy-${i}`,
          settings: {
            baud: 115200,
            databits: 8,
            parity: "none",
            stopbits: 1,
            flow: "none",
          },
        },
      });
      devices.push({ ...(await response.json()), path: `mock:copy-${i}` });
    }
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:18889",
    });
    await page.goto("http://127.0.0.1:18889");
    await page
      .getByRole("tab", { name: "Multi-port workspace", exact: true })
      .click();
    await expect(page.locator(".port-state")).toHaveText([
      "Receiving",
      "Receiving",
    ]);
    const a = page.locator('.port-panel[data-device="mock:copy-0"]'),
      b = page.locator('.port-panel[data-device="mock:copy-1"]');
    await api.post(`/sessions/${devices[0].id}/v1/write`, {
      data: { text: "alpha-copy" },
    });
    await api.post(`/sessions/${devices[1].id}/v1/write`, {
      data: { text: "bravo-private" },
    });
    await expect(a.locator(".port-entry.rx")).toContainText(["alpha-copy"]);
    await a.getByRole("button", { name: "Pause display", exact: true }).click();
    await api.post(`/sessions/${devices[0].id}/v1/write`, {
      data: { text: "late-alpha" },
    });
    await expect(b.locator(".port-entry.rx")).toContainText(["bravo-private"]);
    await a.getByRole("button", { name: "Copy log", exact: true }).click();
    await expect.poll(() => clipboard(page)).toContain("alpha-copy");
    expect(await clipboard(page)).not.toMatch(/late-alpha|bravo-private/);
    await a
      .getByRole("button", { name: "Resume display", exact: true })
      .click();
    await expect(a.locator(".port-entry.rx")).toContainText([
      "alpha-copy",
      "late-alpha",
    ]);
    await a
      .getByRole("textbox", { name: "Filter this log", exact: true })
      .fill("late-");
    await a.getByRole("button", { name: "Copy log", exact: true }).click();
    await expect.poll(() => clipboard(page)).toContain("late-alpha");
    expect(await clipboard(page)).not.toContain("alpha-copy");
    await a.locator(".port-entry.rx").hover();
    await a.getByRole("button", { name: "Copy payload", exact: true }).click();
    await expect.poll(() => clipboard(page)).toBe("late-alpha");
  } finally {
    for (const device of devices)
      await api.delete(`/manager/sessions/${device.id}`);
    await api.dispose();
  }
});

test("the legacy copy fallback writes real clipboard text when the modern API is unavailable", async ({
  page,
  context,
  request,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:18887",
  });
  await page.addInitScript(() => {
    const read = navigator.clipboard.readText.bind(navigator.clipboard);
    Object.assign(window, { __nativeClipboardRead: read });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });
  await connect(page);
  const marker = `legacy-clipboard-${Date.now()}`;
  await request.post("/v1/write", { data: { text: marker } });
  await page.getByLabel("Search terminal log", { exact: true }).fill(marker);
  await expect(page.locator(".line.rx")).toHaveCount(1);
  await page.getByRole("button", { name: "Copy log", exact: true }).click();
  await expect(page.locator(".clipboard-notice")).toHaveText("Copied");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as Window & { __nativeClipboardRead: () => Promise<string> }
        ).__nativeClipboardRead(),
      ),
    )
    .toContain(marker);
});
