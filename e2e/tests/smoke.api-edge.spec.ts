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

const edgeHosts = [
  ["the tenant site", WEB_STOREFRONT_BASE_URL],
  ["the tenant console", WEB_ADMIN_BASE_URL],
  ["the platform console", WEB_PLATFORM_BASE_URL],
] as const;

/** The JSON body of a procedure call, naming the tenant when it needs one. */
interface EdgeRequest {
  tenant?: { tenantId: string };
}

interface EdgeAnswer {
  code: string | undefined;
  status: number;
}

const isConnectError = (value: unknown): value is { code: string } =>
  typeof value === "object" &&
  value !== null &&
  "code" in value &&
  typeof value.code === "string";

/**
 * The request is sent from inside the page so it carries that page's Host, and
 * because `*.localhost` names are resolved by Chromium rather than by the
 * machine the runner is on. It carries no session cookie of the API's own, so
 * a console procedure that reached the server would see an anonymous caller.
 */
const postThroughEdge = async (
  page: Page,
  procedure: string,
  body: EdgeRequest = {}
): Promise<EdgeAnswer> => {
  const answered = await page.evaluate(
    async ([path, json]) => {
      const response = await fetch(path, {
        body: json,
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      const answer: unknown = await response.json().catch(() => null);

      return { answer, status: response.status };
    },
    [procedure, JSON.stringify(body)] as const
  );

  // Anything but a Connect error leaves the code undefined.
  return {
    code: isConnectError(answered.answer) ? answered.answer.code : undefined,
    status: answered.status,
  };
};

/**
 * One process serves all three Connect namespaces under `/rpc`, but
 * the edge forwards only the public one: the consoles call theirs over the
 * private network, so no host needs them, and the edge answers them itself on
 * every host. The tenant console's procedure names a tenant that exists, so a
 * request that did reach the server would be refused for its caller, with a
 * `401`, rather than for its tenant.
 */
test.describe("the edge forwards only the public API namespace", () => {
  for (const [label, baseUrl] of edgeHosts) {
    test(`answers the console namespaces with 404 on ${label}`, async ({
      page,
    }) => {
      await page.goto(baseUrl);

      const answeredByTheEdge = { code: undefined, status: 404 };
      expect(
        await postThroughEdge(page, `/rpc${ADMIN_PROCEDURE}`, {
          tenant: { tenantId: SEED_TENANT_ID },
        })
      ).toEqual(answeredByTheEdge);
      expect(await postThroughEdge(page, `/rpc${PLATFORM_PROCEDURE}`)).toEqual(
        answeredByTheEdge
      );
      // The public namespace is answered on the same host and path prefix.
      const catalog = await postThroughEdge(page, `/rpc${CATALOG_PROCEDURE}`);
      expect(catalog.status).not.toBe(404);
    });
  }
});
