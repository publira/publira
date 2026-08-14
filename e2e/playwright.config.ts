import { defineConfig, devices } from "@playwright/test";

import {
  WEB_ADMIN_BASE_URL,
  WEB_HOST_BASE_URL,
  WEB_PLATFORM_BASE_URL,
} from "./src/urls";

const isCi = Boolean(process.env.CI);

const desktopChrome = devices["Desktop Chrome"];

/**
 * Specs that stop a shared process (`stopApiServer`, admin-api-server.sh).
 * They cannot overlap with each other (same API) or with the three main
 * projects (those still need the APIs up). Filename is the contract: a new
 * process-killing spec must match this pattern so it is kept out of the
 * parallel projects. See the isolated projects below.
 */
const processIsolatedSpecs = /\.(?:outage|error-boundary)\./u;

/**
 * CI is ubicloud-standard-4 (4 vCPU). Three workers leave headroom for the
 * Next servers, Go APIs, and Chromium. The same count is used locally so
 * isolation assumptions match CI. CLI `--workers=1` still overrides.
 */
const workers = 3;

export default defineConfig({
  expect: {
    timeout: 15_000,
  },
  forbidOnly: isCi,
  // File-level parallelism only. Tests in one file stay in order so shared
  // seed accounts and in-file afterEach cleanup do not race. Specs that stop
  // a process are kept off this pool by the isolated projects below.
  fullyParallel: false,
  projects: [
    {
      name: "web-host",
      testIgnore: [/admin\./u, /platform\./u, processIsolatedSpecs],
      use: {
        ...desktopChrome,
        baseURL: WEB_HOST_BASE_URL,
      },
    },
    {
      name: "web-admin",
      testIgnore: [processIsolatedSpecs],
      testMatch: [/admin\./u],
      timeout: 120_000,
      use: {
        ...desktopChrome,
        baseURL: WEB_ADMIN_BASE_URL,
      },
    },
    {
      name: "web-platform",
      testIgnore: [processIsolatedSpecs],
      testMatch: [/platform\./u],
      timeout: 120_000,
      use: {
        ...desktopChrome,
        baseURL: WEB_PLATFORM_BASE_URL,
      },
    },
    // Public API outage: catalog.outage and catalog.error-boundary both call
    // stopApiServer, so they are separate projects chained with `dependencies`
    // (Playwright has no per-project workers; a single project would still
    // fan the two files across the global worker pool).
    {
      dependencies: ["web-host", "web-admin", "web-platform"],
      fullyParallel: false,
      name: "catalog-outage",
      testMatch: [/catalog\.outage\./u],
      use: {
        ...desktopChrome,
        baseURL: WEB_HOST_BASE_URL,
      },
    },
    {
      dependencies: ["catalog-outage"],
      fullyParallel: false,
      name: "catalog-error-boundary",
      testMatch: [/catalog\.error-boundary\./u],
      use: {
        ...desktopChrome,
        baseURL: WEB_HOST_BASE_URL,
      },
    },
    // admin-api-server, not the public API. Safe to overlap with the catalog
    // outage projects; not safe to overlap with web-admin.
    {
      dependencies: ["web-host", "web-admin", "web-platform"],
      fullyParallel: false,
      name: "admin-error-boundary",
      testMatch: [/admin\.error-boundary\./u],
      timeout: 120_000,
      use: {
        ...desktopChrome,
        baseURL: WEB_ADMIN_BASE_URL,
      },
    },
    // platform-api-server. Same filename contract as admin; no spec yet.
    // Two files that stop this API must be split and chained, as catalog is.
    {
      dependencies: ["web-host", "web-admin", "web-platform"],
      fullyParallel: false,
      name: "platform-error-boundary",
      testMatch: [/platform\.(?:outage|error-boundary)\./u],
      timeout: 120_000,
      use: {
        ...desktopChrome,
        baseURL: WEB_PLATFORM_BASE_URL,
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
  workers,
});
