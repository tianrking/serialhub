import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:18887",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: {
    command: process.env.SERIALHUB_E2E_PROFILE === "release"
      ? "cargo run --locked --release --bin serialhub -- run -c web/e2e/hub.toml"
      : "cargo run --locked -- run -c web/e2e/hub.toml",
    cwd: "..",
    url: "http://127.0.0.1:18887/v1/health",
    timeout: 180000,
    reuseExistingServer: !process.env.CI,
  },
});
