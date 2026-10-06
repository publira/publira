import type { PlaywrightTestProject } from "@playwright/test";
import { defineConfig, devices } from "@playwright/test";

import {
  BROWSER_WS_ENDPOINT,
  WEB_ADMIN_AGE_VERIFICATION_BASE_URL,
  WEB_ADMIN_BASE_URL,
  WEB_HOST_BASE_URL,
  WEB_PLATFORM_BASE_URL,
} from "./src/urls";

const isCi = Boolean(process.env.CI);

const desktopChrome = devices["Desktop Chrome"];

/**
 * Specs that stop the backend (`stopServer`). One process serves all three
 * Connect namespaces and the images, so they cannot overlap with each other or
 * with the three main projects (those still need the API up). Filename is the contract: a new
 * process-killing spec must match this pattern so it is kept out of the
 * parallel projects. See the isolated projects below.
 */
const processIsolatedSpecs = /\.(?:outage|error-boundary)\./u;

/**
 * The spec that changes the saved platform default locale. `platform_config`
 * is one row for the whole deployment and every console screen without a
 * `publira_locale` cookie renders in the language it names, so this one cannot
 * overlap with the rest of the web-platform project. It is chained after the
 * platform outage projects below, which stop the API it needs.
 */
const platformLocaleSwitchingSpecs = /platform\.locale-switching\./u;

/**
 * The spec that rewrites the role and the status of operators seeded by
 * `030_platform_operators.sql`. `platform.tenant-ops.spec.ts` re-applies that
 * file from inside its own tests, which would reactivate a deactivated operator
 * half-way through an assertion, so this one runs after the web-platform project
 * rather than beside it.
 */
const platformOperatorManagementSpecs = /platform\.operator-management\./u;

/**
 * The spec that rewrites `platform_storage_config`, the one object store every
 * upload and every image read in the stack resolves. It empties the row once
 * and re-saves it, so it runs after the parallel projects rather than beside
 * the suites that upload an eye-catch or read an episode body.
 */
const platformStorageSettingsSpecs = /platform\.storage-settings\./u;

/**
 * The spec that rewrites `platform_webpush_config`, whose key pair and subject
 * the storefront's browser notification switch depends on. It clears the
 * subject once and saves another, so it runs after the parallel projects
 * rather than beside the member settings suite that subscribes a browser.
 */
const platformWebPushSettingsSpecs = /platform\.webpush-settings\./u;

/**
 * The spec that empties `platform_storage_config` and the Web Push subject to
 * show the configuration overview an unfinished installation, then saves the
 * store again. It runs after the parallel projects for the same reasons the
 * two settings suites above do.
 */
const platformConfigurationStatusSpecs = /platform\.configuration-status\./u;

/**
 * This spec changes its tenant's saved comment mode twice and waits for the
 * public cache to observe each value. It runs after the parallel projects so
 * their requests cannot keep the old mode live while that round trip runs.
 */
const commentModerationSpecs = /admin\.comment-moderation\./u;

/**
 * The spec that changes its tenant's saved age verification rule and waits for
 * the public gate to observe each value. `host.age-verification.spec.ts` reads
 * the same tenant through the rule the scenario seeds, so this one runs after
 * the parallel projects rather than beside it.
 */
const ageVerificationSpecs = /admin\.age-verification\./u;

/**
 * The spec that makes the platform require MFA of tenant administrators, which
 * every console sign-in reads. It runs after the parallel projects so no other
 * suite's administrator is held for an enrollment.
 */
const adminMfaSignInSpecs = /admin\.mfa-sign-in\./u;

/**
 * The spec that drives initial setup. `/setup` renders only while the platform
 * has no operator at all, so it empties `platform_users` — the table every
 * console sign-in in the suite reads — and runs last of everything.
 */
const platformSetupSpecs = /platform\.setup\./u;

/**
 * Timing suites. They report how long the browser took, so they must not share
 * a machine with the other projects; the viewer-performance project below runs
 * them in a group of their own, and after everything else when every group
 * shares one stack.
 */
const performanceSpecs = /\.viewer-performance\./u;

/**
 * The suite that reads what a server process logged rather than what a page
 * showed, so its project below runs last of everything.
 */
const serverLogSpecs = /\/logs\./u;

/**
 * The catalog search suite, which `task e2e:search` runs on its own with the
 * OpenSearch backend selected. It has a project of its own so that run can
 * name it alone; in every other run it runs beside the ordinary projects, on
 * the SQL backend.
 */
const catalogSearchSpecs = /catalog\.search\./u;

/**
 * The spec that rewrites `platform_search_config`, the engine every storefront
 * search answers from, and under `task e2e:search` moves the search off
 * OpenSearch and back. It runs after the catalog search suite rather than
 * beside it, and the `search` group below runs the two on their own.
 */
const platformSearchSettingsSpecs = /platform\.search-settings\./u;

/**
 * The suites that record what a screen looks like. In a run of the whole
 * graph they run before every other project, as its dependency, because the
 * state they photograph is the one `task e2e:db` seeded: the admin console
 * lists the series the publishing suites create, and the public catalogue
 * lists the episodes they publish.
 *
 * They also render in a different browser from the rest — the pinned image of
 * `browser/Dockerfile`, reached over `connectOptions` — so a baseline taken on
 * a workstation and the comparison CI runs are rasterized by the same fonts.
 */
const screenshotSpecs = /\.screenshots\./u;

/** What a screenshot project shares with the two others. */
const screenshotProjectUse = {
  ...desktopChrome,
  connectOptions: { wsEndpoint: BROWSER_WS_ENDPOINT },
} as const;

/** Every project the screenshot suites have to precede. */
const screenshotDependencies = [
  "screenshots-host",
  "screenshots-admin",
  "screenshots-platform",
];

/**
 * CI is `ubuntu-latest`, which a public repository gets with 4 vCPU. Three
 * workers leave headroom for the Next servers, the Go server, and Chromium. The same
 * count is used locally so isolation assumptions match CI. CLI `--workers=1`
 * still overrides.
 */
const workers = 3;

// First, and in the pinned browser: what they record is the state
// `task e2e:db` left, before a publishing suite has put another series in
// the console's list or another episode on the public catalogue.
const screenshotProjects: PlaywrightTestProject[] = [
  {
    name: "screenshots-host",
    testMatch: [/host\.screenshots\./u],
    use: {
      ...screenshotProjectUse,
      baseURL: WEB_HOST_BASE_URL,
    },
  },
  {
    name: "screenshots-admin",
    testMatch: [/admin\.screenshots\./u],
    timeout: 120_000,
    use: {
      ...screenshotProjectUse,
      baseURL: WEB_ADMIN_BASE_URL,
    },
  },
  {
    name: "screenshots-platform",
    testMatch: [/platform\.screenshots\./u],
    timeout: 120_000,
    use: {
      ...screenshotProjectUse,
      baseURL: WEB_PLATFORM_BASE_URL,
    },
  },
];

const mainProjects: PlaywrightTestProject[] = [
  {
    dependencies: screenshotDependencies,
    name: "web-host",
    testIgnore: [
      /admin\./u,
      /platform\./u,
      processIsolatedSpecs,
      performanceSpecs,
      screenshotSpecs,
      serverLogSpecs,
      catalogSearchSpecs,
    ],
    use: {
      ...desktopChrome,
      baseURL: WEB_HOST_BASE_URL,
    },
  },
  // After the screenshots for the reason the three projects around it are:
  // it publishes series of its own on the seed tenant, whose catalogue the
  // screenshot projects photograph.
  {
    dependencies: screenshotDependencies,
    name: "catalog-search",
    testMatch: [catalogSearchSpecs],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_HOST_BASE_URL,
    },
  },
  // Moves the storefront search from one engine to another, so it follows
  // the catalog search suite rather than running beside it.
  {
    dependencies: ["catalog-search"],
    fullyParallel: false,
    name: "platform-search-settings",
    testMatch: [platformSearchSettingsSpecs],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_PLATFORM_BASE_URL,
    },
  },
  {
    dependencies: screenshotDependencies,
    name: "web-platform",
    testIgnore: [
      processIsolatedSpecs,
      platformSearchSettingsSpecs,
      platformLocaleSwitchingSpecs,
      platformOperatorManagementSpecs,
      platformStorageSettingsSpecs,
      platformWebPushSettingsSpecs,
      platformConfigurationStatusSpecs,
      platformSetupSpecs,
      performanceSpecs,
      screenshotSpecs,
      serverLogSpecs,
    ],
    testMatch: [/platform\./u],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_PLATFORM_BASE_URL,
    },
  },
];

// The slowest of the ordinary projects, by more than the other three
// together, so a group of its own: Playwright shards by test count, which
// only splits a run evenly when its tests take about as long as each other.
const adminProjects: PlaywrightTestProject[] = [
  {
    dependencies: screenshotDependencies,
    name: "web-admin",
    testIgnore: [
      processIsolatedSpecs,
      commentModerationSpecs,
      ageVerificationSpecs,
      adminMfaSignInSpecs,
      performanceSpecs,
      screenshotSpecs,
      serverLogSpecs,
    ],
    testMatch: [/admin\./u],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_ADMIN_BASE_URL,
    },
  },
];

const exclusiveProjects: PlaywrightTestProject[] = [
  // Backend outage. Every file below calls stopServer, which takes all three
  // namespaces down with the one process, so they form a single chain
  // through `dependencies` — one project per filename, because Playwright
  // has no per-project workers and a shared project would still fan its
  // files across the global worker pool.
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
  {
    dependencies: ["catalog-error-boundary"],
    fullyParallel: false,
    name: "admin-outage",
    testMatch: [/admin\.outage\./u],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_ADMIN_BASE_URL,
    },
  },
  {
    dependencies: ["admin-outage"],
    fullyParallel: false,
    name: "admin-error-boundary",
    testMatch: [/admin\.error-boundary\./u],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_ADMIN_BASE_URL,
    },
  },
  {
    dependencies: ["admin-error-boundary"],
    fullyParallel: false,
    name: "platform-outage",
    testMatch: [/platform\.outage\./u],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_PLATFORM_BASE_URL,
    },
  },
  {
    dependencies: ["platform-outage"],
    fullyParallel: false,
    name: "platform-error-boundary",
    testMatch: [/platform\.error-boundary\./u],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_PLATFORM_BASE_URL,
    },
  },
  // Changes the saved platform default locale, which every web-platform
  // screen without a `publira_locale` cookie renders in. Chained after the
  // platform outage projects rather than run beside them: those stop the
  // platform API, and the rest of the web-platform project reads the console
  // in the language this spec briefly replaces.
  {
    dependencies: ["platform-error-boundary"],
    fullyParallel: false,
    name: "platform-locale-switching",
    testMatch: [platformLocaleSwitchingSpecs],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_PLATFORM_BASE_URL,
    },
  },
  // Rewrites the role and the status of the scenario operators the parallel
  // web-platform project re-seeds, so it takes the same treatment as the
  // locale spec above and follows it in the platform chain.
  {
    dependencies: ["platform-locale-switching"],
    fullyParallel: false,
    name: "platform-operator-management",
    testMatch: [platformOperatorManagementSpecs],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_PLATFORM_BASE_URL,
    },
  },
  // Rewrites the installation's object store, which every upload and image
  // read resolves, so it follows the operator spec in the platform chain and
  // precedes every project that reads an image.
  {
    dependencies: ["platform-operator-management"],
    fullyParallel: false,
    name: "platform-storage-settings",
    testMatch: [platformStorageSettingsSpecs],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_PLATFORM_BASE_URL,
    },
  },
  // Rewrites the installation's Web Push subject, which the storefront reads
  // to offer browser notifications, so it follows the storage spec in the
  // platform chain.
  {
    dependencies: ["platform-storage-settings"],
    fullyParallel: false,
    name: "platform-webpush-settings",
    testMatch: [platformWebPushSettingsSpecs],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_PLATFORM_BASE_URL,
    },
  },
  // Empties the object store and the Web Push subject once more to show the
  // configuration overview an unfinished installation, so it follows the
  // Web Push spec in the platform chain.
  {
    dependencies: ["platform-webpush-settings"],
    fullyParallel: false,
    name: "platform-configuration-status",
    testMatch: [platformConfigurationStatusSpecs],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_PLATFORM_BASE_URL,
    },
  },
  // This round trip changes a tenant-wide setting and asks web-host to read
  // both values through its cache. It follows every parallel project so
  // concurrent requests cannot race either cache revalidation.
  {
    dependencies: [
      "catalog-error-boundary",
      "admin-error-boundary",
      "platform-configuration-status",
    ],
    fullyParallel: false,
    name: "admin-comment-moderation",
    testMatch: [commentModerationSpecs],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_ADMIN_BASE_URL,
    },
  },
  // The same shape, on the tenant that makes readers prove an age: the
  // console writes the rule and the storefront is asked to read it back. It
  // follows the moderation round trip rather than running beside it, so the
  // two cache revalidations are never in flight at once.
  {
    dependencies: ["admin-comment-moderation"],
    fullyParallel: false,
    name: "admin-age-verification",
    testMatch: [ageVerificationSpecs],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_ADMIN_AGE_VERIFICATION_BASE_URL,
    },
  },
  // Requires MFA of every tenant administrator for as long as it runs, so it
  // follows the last console round trip rather than running beside one.
  {
    dependencies: ["admin-age-verification"],
    fullyParallel: false,
    name: "admin-mfa-sign-in",
    testMatch: [adminMfaSignInSpecs],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_ADMIN_BASE_URL,
    },
  },
  // After everything, including the timing suite when that shares the
  // stack: it leaves the platform with no operator for as long as it takes
  // to create one through `/setup`, and every console screen in the suite
  // needs one to sign in as. It restores the development seed's platform
  // rows on teardown.
  {
    dependencies: ["admin-mfa-sign-in", "viewer-performance"],
    fullyParallel: false,
    name: "platform-setup",
    testMatch: [platformSetupSpecs],
    timeout: 120_000,
    use: {
      ...desktopChrome,
      baseURL: WEB_PLATFORM_BASE_URL,
    },
  },
];

const performanceProjects: PlaywrightTestProject[] = [
  // On its own: it measures elapsed time, so nothing else may be competing
  // for the CPU. On a stack it shares, depending on the tail of every chain
  // above is what empties the worker pool for it.
  {
    dependencies: [
      "catalog-error-boundary",
      "admin-error-boundary",
      "platform-configuration-status",
      "admin-mfa-sign-in",
    ],
    fullyParallel: false,
    name: "viewer-performance",
    testMatch: [performanceSpecs],
    use: {
      ...desktopChrome,
      baseURL: WEB_HOST_BASE_URL,
    },
  },
];

/**
 * The projects CI runs as separate jobs, each on a runner of its own with a
 * stack of its own. `PUBLIRA_E2E_GROUP` names one of them, and the run is then
 * that group's projects alone.
 *
 * The `dependencies` between groups only order work on one shared stack: the
 * screenshot projects before the publishing suites, the outage and
 * deployment-wide suites after the parallel ones, the timing suite after
 * everything. A group run drops them, since another group's projects are not
 * on its stack, and keeps the ones inside the group. A project therefore may
 * not need what another group's project leaves behind.
 *
 * Without `PUBLIRA_E2E_GROUP` the run is every group on one stack, ordered by
 * the whole graph, which is what `task e2e` does.
 */
const groups = {
  admin: adminProjects,
  exclusive: exclusiveProjects,
  main: mainProjects,
  performance: performanceProjects,
  screenshots: screenshotProjects,
  // `task e2e:search`, on the OpenSearch backend: the catalog search suite
  // and then the suite that moves the search off the engine and back. No CI
  // matrix entry names it; Test / E2E Search runs it as a job of its own.
  search: mainProjects.filter(({ name }) =>
    ["catalog-search", "platform-search-settings"].includes(name ?? "")
  ),
} satisfies Record<string, PlaywrightTestProject[]>;

type GroupName = keyof typeof groups;

const isGroupName = (name: string): name is GroupName =>
  Object.hasOwn(groups, name);

const groupName = process.env.PUBLIRA_E2E_GROUP?.trim() || undefined;

if (groupName !== undefined && !isGroupName(groupName)) {
  throw new Error(
    `PUBLIRA_E2E_GROUP=${groupName} names no group; use one of ${Object.keys(groups).join(", ")}`
  );
}

const withinGroup = (
  projects: PlaywrightTestProject[]
): PlaywrightTestProject[] => {
  const names = new Set(projects.map(({ name }) => name));
  return projects.map((project) => ({
    ...project,
    dependencies: project.dependencies?.filter((name) => names.has(name)),
  }));
};

const selectedProjects =
  groupName === undefined
    ? [
        ...screenshotProjects,
        ...mainProjects,
        ...adminProjects,
        ...exclusiveProjects,
        ...performanceProjects,
      ]
    : withinGroup(groups[groupName]);

/**
 * Reads what the server processes logged, so every request the run makes has
 * to have been answered first. It is the teardown of every other project —
 * Playwright starts a teardown once the projects naming it and everything
 * depending on them have finished — rather than a project depending on them:
 * a dependency of a sharded project would run in full in every shard, while a
 * teardown runs once per shard, after that shard's own tests, against that
 * shard's own stack.
 */
const serverLogs: PlaywrightTestProject = {
  fullyParallel: false,
  name: "server-logs",
  testMatch: [serverLogSpecs],
};

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
    ...selectedProjects.map((project) => ({
      ...project,
      teardown: serverLogs.name,
    })),
    serverLogs,
  ],
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    // One per CI job, which the E2E report job merges into one HTML report
    // when a job fails. The job names the file through
    // PLAYWRIGHT_BLOB_OUTPUT_NAME, since every job would otherwise write the
    // same `report.zip`.
    ...(isCi ? [["blob"] as const] : []),
  ],
  retries: isCi ? 1 : 0,
  // One directory per screenshot project, named after the screen. The default
  // template ends the file name in the operating system Playwright is running
  // on, which would claim these are per-platform baselines; they are not, since
  // every one of them is rendered by the Linux browser image.
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  // Which job a test ran in, once the reports of every job are merged.
  tag: groupName === undefined ? undefined : `@${groupName}`,
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
