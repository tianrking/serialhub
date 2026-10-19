import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

test("application menu confirms exit and tray/API shutdown updates every browser", async ({
  page,
  context,
}) => {
  const profile =
    process.env.SERIALHUB_E2E_PROFILE === "release" ? "release" : "debug";
  const binary = resolve(
    "..",
    "target",
    profile,
    process.platform === "win32" ? "serialhub.exe" : "serialhub",
  );
  const child = spawn(
    binary,
    ["desktop", "--bind", "127.0.0.1:0", "--no-browser"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  let address = "";
  try {
    await expect
      .poll(() => {
        address =
          output.match(/device manager: (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1] ??
          "";
        return address;
      })
      .not.toBe("");
    await page.goto(address);
    await page.getByRole("button", { name: "Try demo", exact: true }).click();
    const active = page.locator(".managed-workspace:not([hidden])");
    await expect(active.locator(".lamp")).toContainText("HTTP + WS");
    await active
      .getByRole("button", { name: "Application menu", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Application menu",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      "Closing this page keeps devices running",
    );
    await dialog
      .getByRole("button", { name: "Quit SerialHub", exact: true })
      .click();
    await expect(
      dialog.getByText("Stop SerialHub and close every device?", {
        exact: true,
      }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(active.locator(".lamp")).toContainText("HTTP + WS");
    await page.keyboard.press("Escape");
    const second = await context.newPage();
    await second.goto(address);
    await expect(second.locator(".manager-session")).toHaveCount(1);
    // Hold a successful poll until after shutdown: a late status response must
    // never resurrect the manager or its workspace after the final SSE event.
    let releasePoll = () => {};
    const heldPoll = new Promise<void>((resolve) => {
      releasePoll = resolve;
    });
    let pollStarted = false;
    await page.route("**/manager/info", async (route) => {
      const response = await route.fetch();
      pollStarted = true;
      await heldPoll;
      await route.fulfill({ response });
    });
    await expect.poll(() => pollStarted).toBe(true);
    // A tray click uses the same cancellation token as this endpoint. Neither
    // browser may remain stuck displaying a disconnected live workspace.
    const exited = once(child, "exit");
    const response = await page.request.post(address + "manager/quit", {
      data: {},
    });
    expect(response.ok()).toBe(true);
    await expect(
      page.getByRole("heading", { name: "SerialHub stopped", exact: true }),
    ).toBeVisible();
    await expect(
      second.getByRole("heading", { name: "SerialHub stopped", exact: true }),
    ).toBeVisible();
    releasePoll();
    await expect(
      page.getByRole("heading", { name: "SerialHub stopped", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".managed-workspace")).toHaveCount(0);
    expect((await exited)[0]).toBe(0);
    await second.close();
  } finally {
    if (child.exitCode === null) {
      await page.request
        .post(address + "manager/quit", { data: {} })
        .catch(() => {});
      if (child.exitCode === null) child.kill("SIGTERM");
    }
  }
});
