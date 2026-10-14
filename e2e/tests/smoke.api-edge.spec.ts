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

/** `/api` is the prefix before `/rpc`, served beside it until 0.2.0. */
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
 * a console procedure sees an anonymous caller.
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
 * One process serves all three Connect namespaces under `/rpc` and `/api`, and
 * the edge forwards both to it on every host, so the console namespaces are reachable
 * from the internet. What keeps an outsider out of them is their own
 * authentication, which refuses an anonymous caller before any handler runs.
 * The tenant console's procedure names a tenant that exists, because the
 * tenant is looked up before the caller is.
 */
test.describe("the edge forwards every API namespace", () => {
  for (const [label, baseUrl] of edgeHosts) {
    for (const prefix of prefixes) {
      test(`refuses an anonymous caller of the console namespaces under ${prefix} on ${label}`, async ({
        page,
      }) => {
        await page.goto(baseUrl);

        const unauthenticated = { code: "unauthenticated", status: 401 };
        expect(
          await postThroughEdge(page, prefix + ADMIN_PROCEDURE, {
            tenant: { tenantId: SEED_TENANT_ID },
          })
        ).toEqual(unauthenticated);
        expect(
          await postThroughEdge(page, prefix + PLATFORM_PROCEDURE)
        ).toEqual(unauthenticated);
        // The public namespace is answered on the same host and path prefix.
        const catalog = await postThroughEdge(page, prefix + CATALOG_PROCEDURE);
        expect(catalog.status).not.toBe(404);
      });
    }
  }
});
