import { test, expect } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:18889" });

test("French workspace navigation fits native font metrics without hiding controls", async ({
  page,
}) => {
  const response = await page.request.post("/manager/sessions", {
    data: {
      path: "mock:header-font-metrics",
      name: "Font metrics",
      settings: {
        baud: 115200,
        databits: 8,
        parity: "none",
        stopbits: 1,
        flow: "none",
      },
    },
  });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  try {
    await page.goto("/");
    await page.getByRole("tab", { name: "Font metrics", exact: true }).click();
    const active = page.locator(".managed-workspace:not([hidden])");
    await expect(active.locator(".lamp")).toContainText("HTTP + WS");
    await active.locator(".language-selector select").selectOption("fr");
    for (const font of [
      "system-ui",
      "Arial, sans-serif",
      "DejaVu Sans, sans-serif",
      "Tahoma, sans-serif",
    ]) {
      const style = await page.addStyleTag({
        content: `.app-managed .sidebar, .app-managed .sidebar button, .app-managed .sidebar select { font-family: ${font}; }`,
      });
      try {
        for (const width of [1280, 1366, 1400]) {
          await page.setViewportSize({ width, height: 768 });
          const metrics = await active.locator(".sidebar").evaluate((bar) => {
            const bounds = bar.getBoundingClientRect();
            return {
              truncated: [...bar.querySelectorAll("nav button span")]
                .filter((text) => text.scrollWidth > text.clientWidth + 1)
                .map((text) => ({
                  label: text.textContent,
                  needed: text.scrollWidth,
                  available: text.clientWidth,
                })),
              oneRow: bounds.height <= 50,
              controlsInside: [
                ...bar.querySelectorAll("button, select, .lamp"),
              ].every((item) => {
                const r = item.getBoundingClientRect();
                return (
                  r.left >= bounds.left &&
                  r.right <= bounds.right &&
                  r.top >= bounds.top &&
                  r.bottom <= bounds.bottom
                );
              }),
            };
          });
          expect(metrics, `${font} at ${width}px`).toEqual({
            truncated: [],
            oneRow: true,
            controlsInside: true,
          });
        }
      } finally {
        await style.evaluate((node) => node.remove());
      }
    }
  } finally {
    await page.request.delete(`/manager/sessions/${id}`);
  }
});
