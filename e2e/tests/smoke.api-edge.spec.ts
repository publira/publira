import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { SEED_TENANT_ID } from "../src/scenarios/auth";
import {
  WEB_ADMIN_BASE_URL,
  WEB_STOREFRONT_BASE_URL,
  WEB_PLATFORM_BASE_URL,
} from "../src/urls";

const CATALOG_PROCEDURE = "/publira.v1.CatalogService/ListPublishedSeries";
const ADMIN_PROCEDURE = "/publira.admin.v1.AdminSeriesService/ListSeries";
const PLATFORM_PROCEDURE =
  "/publira.platform.v1.PlatformTenantService/ListTenants";

/** `/api` is the prefix before `/rpc`, served beside it until 0.3.0. */
const prefixes = ["/rpc", "/api"] as const;

const edgeHosts = [
  ["the tenant site", WEB_STOREFRONT_BASE_URL],
  ["the tenant console", WEB_ADMIN_BASE_URL],
  ["the platform console", WEB_PLATFORM_BASE_URL],
] as const;

interface EdgeAnswer {
  code: string | undefined;
  status: number;
}

/**
 * The request is sent from inside the page so it carries that page's Host, and
 * because `*.localhost` names are resolved by Chromium rather than by the
 * machine the runner is on. It carries no session cookie of the API's own, so
 * a console procedure that reached the server would see an anonymous caller.
 */
const postThroughEdge = (
  page: Page,
  procedure: string,
  body: object = {}
): Promise<EdgeAnswer> =>
  page.evaluate(
    async ([path, json]) => {
      const response = await fetch(path, {
        body: json,
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      let answer: unknown = null;
      try {
        answer = await response.json();
      } catch {
        // Anything but a Connect error leaves the code undefined.
      }
      const code =
        typeof answer === "object" &&
        answer !== null &&
        "code" in answer &&
        typeof answer.code === "string"
          ? answer.code
          : undefined;
      return { code, status: response.status };
    },
    [procedure, JSON.stringify(body)] as const
  );

/**
 * One process serves all three Connect namespaces under `/rpc` and `/api`, but
 * the edge forwards only the public one: the consoles call theirs over the
 * private network, so no host needs them, and the edge answers them itself on
 * every host. The tenant console's procedure names a tenant that exists, so a
 * request that did reach the server would be refused for its caller, with a
 * `401`, rather than for its tenant.
 */
test.describe("the edge forwards only the public API namespace", () => {
  for (const [label, baseUrl] of edgeHosts) {
    for (const prefix of prefixes) {
      test(`answers the console namespaces under ${prefix} with 404 on ${label}`, async ({
        page,
      }) => {
        await page.goto(baseUrl);

        const answeredByTheEdge = { code: undefined, status: 404 };
        expect(
          await postThroughEdge(page, prefix + ADMIN_PROCEDURE, {
            tenant: { tenantId: SEED_TENANT_ID },
          })
        ).toEqual(answeredByTheEdge);
        expect(
          await postThroughEdge(page, prefix + PLATFORM_PROCEDURE)
        ).toEqual(answeredByTheEdge);
        // The public namespace is answered on the same host and path prefix.
        const catalog = await postThroughEdge(page, prefix + CATALOG_PROCEDURE);
        expect(catalog.status).not.toBe(404);
      });
    }
  }
});
