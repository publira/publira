import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  WEB_ADMIN_BASE_URL,
  WEB_HOST_EDGE_BASE_URL,
  WEB_PLATFORM_BASE_URL,
} from "../src/urls";

const CATALOG_PROCEDURE = "/api/publira.v1.CatalogService/ListPublishedSeries";
const ADMIN_PROCEDURE = "/api/publira.admin.v1.AdminSeriesService/ListSeries";
const PLATFORM_PROCEDURE =
  "/api/publira.platform.v1.PlatformTenantService/ListTenants";

const edgeHosts = [
  ["the tenant site", WEB_HOST_EDGE_BASE_URL],
  ["the tenant console", WEB_ADMIN_BASE_URL],
  ["the platform console", WEB_PLATFORM_BASE_URL],
] as const;

/**
 * The request is sent from inside the page so it carries that page's Host, and
 * because `*.localhost` names are resolved by Chromium rather than by the
 * machine the runner is on.
 */
const postThroughEdge = (page: Page, procedure: string): Promise<number> =>
  page.evaluate(async (path) => {
    const response = await fetch(path, {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return response.status;
  }, procedure);

/**
 * One process serves all three Connect namespaces, and the edge forwards
 * `/api` to it on every host. Neither the port nor the protocol separates the
 * namespaces — a Connect handler answers gRPC, gRPC-Web and the Connect
 * protocol on one route — so the only thing keeping the two console APIs off
 * the internet is what the edge-facing listener has registered.
 */
test.describe("the edge serves the public API namespace alone", () => {
  for (const [label, baseUrl] of edgeHosts) {
    test(`refuses the console namespaces on ${label}`, async ({ page }) => {
      await page.goto(baseUrl);

      expect(await postThroughEdge(page, ADMIN_PROCEDURE)).toBe(404);
      expect(await postThroughEdge(page, PLATFORM_PROCEDURE)).toBe(404);
      // The public namespace is reachable on the same host and the same path
      // prefix, so a 404 above is the registration and not a broken route.
      expect(await postThroughEdge(page, CATALOG_PROCEDURE)).not.toBe(404);
    });
  }
});
