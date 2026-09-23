/**
 * Fail when a public-reader capability of web-host has no place in the mobile
 * app's parity matrix.
 *
 *     node scripts/check-reader-parity.ts
 *
 * `mobile/integration_test/reader_parity.json` lists what a reader can do on
 * the storefront, each with the app's way to do the same thing or an explicit
 * exception saying why the app has none. A capability is what web-host serves
 * to a reader: every page under `[tenant_id]/[locale]`, every route handler
 * under `[tenant_id]/api`, and every public API call it makes, through
 * whichever variable holds the client. Each of those has to be claimed by an entry, so a new page or a
 * new call fails here until whoever adds it says where the app stands.
 *
 * The matrix is also held to what it claims: a web route or call it names must
 * still exist, an app call it names must be one the app makes, and a test it
 * names must be one under `mobile/integration_test/`. A capability whose record
 * the server keeps for both surfaces (`sharedRecord`) has to name a test, since
 * that record is what a reader carries from one surface to the other. The app
 * routes an entry names are resolved against the router by
 * `mobile/test/reader_parity_test.dart`, because only go_router can match them.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const WEB_APP_ROOT = "apps/web-host/app/[tenant_id]";
const WEB_SOURCE_ROOT = "apps/web-host";
const PUBLIC_CLIENT_PATH = "packages/api-client/src/public/client.ts";
const PUBLIC_PROTO_ROOT = "proto/publira/v1";
const MOBILE_SOURCE_ROOT = "mobile/lib";
const MOBILE_TEST_ROOT = "mobile/integration_test";
const MATRIX_PATH = "mobile/integration_test/reader_parity.json";

const SKIP_DIRECTORIES = new Set([".next", ".turbo", "node_modules"]);

interface Surface {
  routes?: string[];
  rpcs?: string[];
}

export interface Capability {
  exception?: string;
  mobile?: Surface;
  name: string;
  sharedRecord?: boolean;
  tests?: string[];
  web: Surface;
}

export interface Inventory {
  /** RPC method names the app sends, as `Service/Method` spells the method. */
  mobileRpcs: Set<string>;
  /** The integration test sources, concatenated. */
  mobileTests: string;
  webRoutes: Set<string>;
  webRpcs: Set<string>;
}

/** `  catalog: Client<typeof CatalogService>;` → `catalog`. */
const CLIENT_SERVICE = /^\s*(?<service>\w+): Client<typeof \w+>;/gmu;
/** `  rpc GetSeriesDetail(GetSeriesDetailRequest)` → `GetSeriesDetail`. */
const PROTO_RPC = /^\s*rpc (?<method>\w+)\(/gmu;
/** `'/publira.v1.CatalogService/GetSeriesDetail'` → `GetSeriesDetail`. */
const MOBILE_RPC = /Service\/(?<method>[A-Z]\w*)'/gu;

const capitalize = (name: string): string =>
  name.charAt(0).toUpperCase() + name.slice(1);

const isTestFile = (file: string): boolean =>
  /\.(?:test|spec)\.[jt]sx?$/u.test(file);

const walk = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return SKIP_DIRECTORIES.has(entry.name) ? [] : await walk(entryPath);
      }

      return [entryPath];
    })
  );

  return files.flat();
};

/**
 * The route a web file serves, as its directory below `[tenant_id]`: a page
 * under `[locale]` or a route handler under `api`. Anything else there — the
 * theme stylesheet, the `.well-known` files — is not something a reader does.
 */
export const webRouteOf = (file: string): string | null => {
  const relative = path.relative(WEB_APP_ROOT, file).split(path.sep);
  const name = relative.at(-1);
  const [top] = relative;
  const isPage = top === "[locale]" && name === "page.tsx";
  const isHandler = top === "api" && name === "route.ts";

  return isPage || isHandler ? relative.slice(0, -1).join("/") : null;
};

export const methodsIn = (source: string, pattern: RegExp): string[] =>
  Array.from(source.matchAll(pattern), (match) =>
    capitalize(match.groups?.method ?? "")
  );

/**
 * The public API calls in a web source, found by the client's service names
 * rather than by the variable that holds the client: a helper handed the client
 * as `publicApiClient` calls `publicApiClient.domain.getTenantByDomain`. Only a
 * method the public protos define counts, so `result.pages.map` is not one.
 */
export const webCallsIn = (
  source: string,
  services: string[],
  rpcs: Set<string>
): string[] => {
  const call = new RegExp(
    String.raw`\.(?:${services.join("|")})\.(?<method>\w+)\b`,
    "gu"
  );

  return methodsIn(source, call).filter((method) => rpcs.has(method));
};

/** What an entry says web-host serves, held to what web-host still serves. */
const webProblems = (
  capability: Capability,
  inventory: Inventory
): string[] => [
  ...(capability.web.routes ?? [])
    .filter((route) => !inventory.webRoutes.has(route))
    .map(
      (route) =>
        `"${capability.name}" names the web route ${route}, which web-host no longer serves.`
    ),
  ...(capability.web.rpcs ?? [])
    .filter((rpc) => !inventory.webRpcs.has(rpc))
    .map(
      (rpc) =>
        `"${capability.name}" names the web call ${rpc}, which web-host no longer makes.`
    ),
];

/** The app's side of an entry: one path or one exception, and calls it makes. */
const mobileProblems = (
  capability: Capability,
  inventory: Inventory
): string[] => {
  const { exception, mobile, name } = capability;
  if (mobile && exception) {
    return [
      `"${name}" has both a mobile path and an exception; keep the one that is true.`,
    ];
  }
  if (!mobile) {
    return exception?.trim()
      ? []
      : [`"${name}" has neither a mobile path nor an exception.`];
  }
  const rpcs = mobile.rpcs ?? [];
  if ((mobile.routes ?? []).length === 0 && rpcs.length === 0) {
    return [
      `"${name}" names no app route and no app call for its mobile path.`,
    ];
  }

  return rpcs
    .filter((rpc) => !inventory.mobileRpcs.has(rpc))
    .map(
      (rpc) =>
        `"${name}" names the app call ${rpc}, which the app does not make.`
    );
};

const testProblems = (
  capability: Capability,
  inventory: Inventory
): string[] => {
  const tests = capability.tests ?? [];
  const missing = tests
    .filter((test) => !inventory.mobileTests.includes(`'${test}'`))
    .map(
      (test) =>
        `"${capability.name}" names the test "${test}", which is not under ${MOBILE_TEST_ROOT}/.`
    );

  return capability.sharedRecord && tests.length === 0
    ? [
        `"${capability.name}" is a shared record and names no integration test that covers it from the app.`,
        ...missing,
      ]
    : missing;
};

const unclaimed = (
  served: Set<string>,
  claimed: Set<string>,
  kind: string
): string[] =>
  [...served]
    .filter((item) => !claimed.has(item))
    .toSorted()
    .map(
      (item) =>
        `web-host ${kind} ${item}, which ${MATRIX_PATH} does not list: name the app's path to it, or the exception.`
    );

export const findProblems = (
  capabilities: Capability[],
  inventory: Inventory
): string[] => {
  const claimedRoutes = new Set(
    capabilities.flatMap((capability) => capability.web.routes ?? [])
  );
  const claimedRpcs = new Set(
    capabilities.flatMap((capability) => capability.web.rpcs ?? [])
  );

  return [
    ...capabilities.flatMap((capability) => [
      ...webProblems(capability, inventory),
      ...mobileProblems(capability, inventory),
      ...testProblems(capability, inventory),
    ]),
    ...unclaimed(inventory.webRoutes, claimedRoutes, "serves"),
    ...unclaimed(inventory.webRpcs, claimedRpcs, "calls"),
  ];
};

const readSources = async (
  root: string,
  accept: (file: string) => boolean
): Promise<string[]> => {
  const all = await walk(root);
  const files = all.filter(accept);

  return await Promise.all(files.map((file) => readFile(file, "utf-8")));
};

const takeInventory = async (): Promise<Inventory> => {
  const client = await readFile(PUBLIC_CLIENT_PATH, "utf-8");
  const services = Array.from(
    client.matchAll(CLIENT_SERVICE),
    (match) => match.groups?.service ?? ""
  );
  const protos = await readSources(PUBLIC_PROTO_ROOT, (file) =>
    file.endsWith(".proto")
  );
  const rpcs = new Set(
    protos.flatMap((source) => methodsIn(source, PROTO_RPC))
  );
  const webFiles = await walk(WEB_APP_ROOT);
  const webRoutes = new Set(
    webFiles.map(webRouteOf).filter((route) => route !== null)
  );
  const webSources = await readSources(
    WEB_SOURCE_ROOT,
    (file) => /\.tsx?$/u.test(file) && !isTestFile(file)
  );
  const mobileSources = await readSources(MOBILE_SOURCE_ROOT, (file) =>
    file.endsWith(".dart")
  );
  const testSources = await readSources(MOBILE_TEST_ROOT, (file) =>
    file.endsWith(".dart")
  );

  return {
    mobileRpcs: new Set(
      mobileSources.flatMap((source) => methodsIn(source, MOBILE_RPC))
    ),
    mobileTests: testSources.join("\n"),
    webRoutes,
    webRpcs: new Set(
      webSources.flatMap((source) => webCallsIn(source, services, rpcs))
    ),
  };
};

const main = async (): Promise<void> => {
  const source = await readFile(MATRIX_PATH, "utf-8");
  const matrix = JSON.parse(source) as { capabilities: Capability[] };
  const inventory = await takeInventory();
  const problems = findProblems(matrix.capabilities, inventory);

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(
        process.env.GITHUB_ACTIONS
          ? `::error file=${MATRIX_PATH}::${problem}`
          : `${MATRIX_PATH}: ${problem}`
      );
    }
    process.exitCode = 1;

    return;
  }

  console.log(
    `${MATRIX_PATH}: every public-reader capability of web-host has a mobile path or an exception.`
  );
};

if (process.argv[1] === import.meta.filename) {
  await main();
}
