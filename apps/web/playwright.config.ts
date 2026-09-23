import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: "list",
  outputDir: "../../.tmp/auth-browser-results",
  use: {
    baseURL: "http://localhost:8081",
    channel:
      process.env.BROWSER_CHANNEL ??
      (process.platform === "win32" ? "msedge" : "chromium"),
    trace: "off", // Do not save passwords/session cookies in traces.
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testMatch: "auth.browser.spec.ts",
      use: { viewport: { width: 1280, height: 900 } },
    },
    {
      name: "mobile",
      testMatch: "mobile.browser.spec.ts",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
