import { defineConfig, devices } from "@playwright/test";

import { WEB_HOST_BASE_URL } from "./src/urls";

const isCi = Boolean(process.env.CI);

export default defineConfig({
  expect: {
    timeout: 15_000,
  },
  forbidOnly: isCi,
  fullyParallel: false,
  projects: [
    {
      name: "web-host",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: WEB_HOST_BASE_URL,
      },
    },
  ],
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  retries: isCi ? 1 : 0,
  testDir: "./tests",
  timeout: 60_000,
  use: {
    baseURL: WEB_HOST_BASE_URL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  workers: 1,
});
