import type { BrowserContext, Page, Request, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql, quoteSqlLiteral, runSql } from "../src/db";
import {
  clearGoogleTagGatewayRequests,
  googleTagGatewayRequests,
} from "../src/google-tag-gateway";
import type { GoogleTagGatewayRequest } from "../src/google-tag-gateway";
import { revalidateStorefrontTags } from "../src/revalidate";
import {
  STOREFRONT_GOOGLE_TAG_READER,
  STOREFRONT_GOOGLE_TAG_SCENARIO,
  STOREFRONT_GOOGLE_TAG_TENANT,
} from "../src/scenarios/storefront-google-tag";
import { signInAsMember } from "../src/storefront";
import {
  GOOGLE_TAG_GATEWAY_BASE_URL,
  WEB_STOREFRONT_GOOGLE_TAG_BASE_URL,
} from "../src/urls";

/**
 * The tenant's Google tag on its site: which loader each serving mode asks
 * for, the page views a client navigation produces, the pages that load none,
 * and the gateway the site runs on its own origin.
 *
 * No request reaches Google. Every origin a loader can come from answers with
 * {@link TAG_STAND_IN}, so what is asserted is the request the site makes and
 * the commands it gives the tag, not what Google's script does with them. The
 * gateway's own suite lets the site's path through to the storefront, which
 * forwards it to the E2E stack's stand-in for Google's gateway.
 */

const siteUrl = (pathname: string): string =>
  `${WEB_STOREFRONT_GOOGLE_TAG_BASE_URL}${pathname}`;

const MEASUREMENT_ID = "G-E2EMEASURE1";
const CONTAINER_ID = "GTM-E2EMSRD";
const SERVER_CONTAINER_URL = "https://sgtm.example.com";
/** A gateway path in the shape the server generates. */
const GATEWAY_PATH = "_measuregatewayaa";

const GOOGLE_TAG_ORIGIN = "https://www.googletagmanager.com";
const GATEWAY_ORIGIN = `${new URL(WEB_STOREFRONT_GOOGLE_TAG_BASE_URL).origin}/${GATEWAY_PATH}/`;

/** Hosts a Google tag loads from or sends to, the stand-in sGTM's included. */
const TAG_HOST =
  /(?:^|\.)(?:google|googletagmanager|google-analytics|googleadservices|doubleclick)\.(?:com|net)$|^sgtm\.example\.com$/u;

/**
 * What every loader URL answers. It keeps the page views a Google tag would
 * send, so a test can count them: one for each `config` command, and one for
 * each history change that moves to another URL — what GA4 sends with page
 * views based on browser history events, which is how a client navigation is
 * measured. gtm.js and gtag.js share it, and the second one to load finds the
 * first one's state.
 */
const TAG_STAND_IN = `(() => {
  if (window.__e2eGoogleTag) return;
  const state = (window.__e2eGoogleTag = { pageViews: [] });
  let configured = false;
  let last = "";
  const view = () => {
    last = location.href;
    state.pageViews.push(location.pathname);
  };
  const changed = () => {
    if (configured && location.href !== last) view();
  };
  const read = (entry) => {
    if (entry && entry[0] === "config") {
      configured = true;
      view();
    }
  };
  const layer = (window.dataLayer = window.dataLayer || []);
  Array.from(layer).forEach(read);
  const push = layer.push.bind(layer);
  layer.push = (...entries) => {
    entries.forEach(read);
    return push(...entries);
  };
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      changed();
      return result;
    };
  }
  addEventListener("popstate", changed);
})();`;

const fulfillStandIn = (route: Route): Promise<void> =>
  route.fulfill({ body: TAG_STAND_IN, contentType: "text/javascript" });

const standInGoogleOrigins = async (context: BrowserContext): Promise<void> => {
  await context.route(
    (url) => TAG_HOST.test(url.hostname),
    async (route) => {
      await (route.request().resourceType() === "script"
        ? fulfillStandIn(route)
        : route.fulfill({ status: 204 }));
    }
  );
};

const standInTagOrigins = async (context: BrowserContext): Promise<void> => {
  await standInGoogleOrigins(context);
  await context.route(`${GATEWAY_ORIGIN}**`, fulfillStandIn);
};

type ServingMode = "gateway" | "google" | "server_container";

/** The tag the storefront holds the tenant's Google tag read under. */
const analyticsSettingsTag = `tenant:${STOREFRONT_GOOGLE_TAG_TENANT.id}:analytics-settings`;

const sqlLiteral = (value: string | undefined): string =>
  value ? quoteSqlLiteral(value) : "NULL";

const storeGoogleTag = async ({
  ga4MeasurementId,
  gtmContainerId,
  mode,
}: {
  ga4MeasurementId?: string;
  gtmContainerId?: string;
  mode: ServingMode;
}): Promise<void> => {
  runSql(`
    INSERT INTO tenant_analytics_settings (
      tenant_id, ga4_measurement_id, gtm_container_id, serving_mode,
      server_container_url, gateway_path
    )
    VALUES (
      '${STOREFRONT_GOOGLE_TAG_TENANT.id}',
      ${sqlLiteral(ga4MeasurementId)},
      ${sqlLiteral(gtmContainerId)},
      '${mode}',
      ${sqlLiteral(mode === "server_container" ? SERVER_CONTAINER_URL : undefined)},
      ${sqlLiteral(mode === "gateway" ? GATEWAY_PATH : undefined)}
    )
    ON CONFLICT (tenant_id) DO UPDATE
    SET ga4_measurement_id = EXCLUDED.ga4_measurement_id,
        gtm_container_id = EXCLUDED.gtm_container_id,
        serving_mode = EXCLUDED.serving_mode,
        server_container_url = EXCLUDED.server_container_url,
        gateway_path = EXCLUDED.gateway_path;
  `);
  await revalidateStorefrontTags([analyticsSettingsTag]);
};

const resetGoogleTag = async (): Promise<void> => {
  applyScenarioSql(STOREFRONT_GOOGLE_TAG_SCENARIO);
  await revalidateStorefrontTags([analyticsSettingsTag]);
};

/** Every request the page makes to a host a tag loads from or sends to. */
const recordTagRequests = (page: Page): string[] => {
  const requested: string[] = [];
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (TAG_HOST.test(url.hostname) || url.href.startsWith(GATEWAY_ORIGIN)) {
      requested.push(url.href);
    }
  });
  return requested;
};

/**
 * Opens `pathname` until the page asks for every one of `loaders`. The
 * settings were written straight to Postgres, and revalidation marks the
 * cached read stale rather than dropping it, so the first load after a change
 * may still render the previous tag. The loaders are waited for together,
 * since the page asks for them at the same moment.
 */
const openUntilRequested = async (
  page: Page,
  pathname: string,
  ...loaders: string[]
): Promise<void> => {
  await expect(async () => {
    const requested = Promise.all(
      loaders.map((loader) => page.waitForRequest(loader, { timeout: 5000 }))
    );
    await page.goto(siteUrl(pathname));
    await requested;
  }).toPass({ timeout: 30_000 });
};

/**
 * Lets every script the page would load after hydration have been asked for.
 * What a page leaves out is an absence, which no web-first assertion can wait
 * for, so the wait is for the network to have gone quiet.
 */
const settle = async (page: Page): Promise<void> => {
  // oxlint-disable-next-line sonarjs/no-networkidle-wait
  await page.waitForLoadState("networkidle");
};

const pageViews = (page: Page): Promise<string[]> =>
  page.evaluate(
    () =>
      (window as unknown as { __e2eGoogleTag?: { pageViews: string[] } })
        .__e2eGoogleTag?.pageViews ?? []
  );

const hasDataLayer = (page: Page): Promise<boolean> =>
  page.evaluate(() => "dataLayer" in window);

const headerLink = (page: Page, name: string) =>
  page.getByRole("navigation").getByRole("link", { exact: true, name }).first();

const gtmLoader = (origin: string) =>
  origin === GOOGLE_TAG_ORIGIN || origin === SERVER_CONTAINER_URL
    ? `${origin}/gtm.js?id=${CONTAINER_ID}`
    : `${origin}?id=${CONTAINER_ID}`;

const gtagLoader = (origin: string) =>
  origin === GOOGLE_TAG_ORIGIN || origin === SERVER_CONTAINER_URL
    ? `${origin}/gtag/js?id=${MEASUREMENT_ID}`
    : `${origin}?id=${MEASUREMENT_ID}`;

test.describe("the tenant's Google tag on its site", () => {
  test.beforeAll(async () => {
    await resetGoogleTag();
  });

  test.afterAll(async () => {
    await resetGoogleTag();
  });

  test.beforeEach(async ({ context }) => {
    await standInTagOrigins(context);
  });

  test("a tenant that has set no ID loads no tag and asks no Google origin", async ({
    page,
  }) => {
    const requested = recordTagRequests(page);

    const response = await page.goto(siteUrl("/"));
    const html = (await response?.text()) ?? "";
    await settle(page);
    await headerLink(page, "Labels").click();
    await expect(page).toHaveURL(siteUrl("/labels"));
    await settle(page);

    expect(requested).toEqual([]);
    expect(html).not.toContain("googletagmanager");
    expect(html).not.toContain("gtag");
    expect(await hasDataLayer(page)).toBe(false);
  });

  for (const { mode, origin } of [
    { mode: "google", origin: GOOGLE_TAG_ORIGIN },
    { mode: "server_container", origin: SERVER_CONTAINER_URL },
    { mode: "gateway", origin: GATEWAY_ORIGIN },
  ] as const) {
    test(`in ${mode} mode both tags are requested from ${origin}`, async ({
      page,
    }) => {
      await storeGoogleTag({
        ga4MeasurementId: MEASUREMENT_ID,
        gtmContainerId: CONTAINER_ID,
        mode,
      });
      const requested = recordTagRequests(page);

      await openUntilRequested(
        page,
        "/",
        gtmLoader(origin),
        gtagLoader(origin)
      );
      await settle(page);

      // Only the two loaders, both from the mode's own origin: nothing is
      // fetched from Google beside a server container or a gateway.
      expect(
        new Set(requested.filter((url) => !url.startsWith(origin)))
      ).toEqual(new Set());

      const config = await page.evaluate(
        () =>
          [
            ...(
              window as unknown as {
                dataLayer: ArrayLike<unknown>[];
              }
            ).dataLayer,
          ].find((entry) => entry[0] === "config")?.[2] ?? null
      );
      expect(config).toEqual(
        mode === "server_container"
          ? { server_container_url: SERVER_CONTAINER_URL }
          : null
      );
    });
  }

  test("a client-side navigation produces exactly one page view", async ({
    page,
  }) => {
    await storeGoogleTag({ ga4MeasurementId: MEASUREMENT_ID, mode: "google" });
    const requested = recordTagRequests(page);

    await openUntilRequested(page, "/", gtagLoader(GOOGLE_TAG_ORIGIN));
    await expect.poll(() => pageViews(page)).toEqual(["/"]);
    await page.evaluate(() => {
      document.documentElement.dataset.e2eDocument = "first";
    });

    await headerLink(page, "Labels").click();
    await expect(page).toHaveURL(siteUrl("/labels"));
    await expect.poll(() => pageViews(page)).toEqual(["/", "/labels"]);

    await headerLink(page, "Genres").click();
    await expect(page).toHaveURL(siteUrl("/genres"));
    await expect
      .poll(() => pageViews(page))
      .toEqual(["/", "/labels", "/genres"]);

    await page.goBack();
    await expect(page).toHaveURL(siteUrl("/labels"));
    await expect
      .poll(() => pageViews(page))
      .toEqual(["/", "/labels", "/genres", "/labels"]);

    await settle(page);
    await expect(
      page.locator("html"),
      "every navigation was a client-side one"
    ).toHaveAttribute("data-e2e-document", "first");
    expect(
      requested.filter((url) => url === gtagLoader(GOOGLE_TAG_ORIGIN)),
      "the tag was loaded once for the whole document"
    ).toHaveLength(1);
  });

  test("the pages that take credentials load no tag", async ({ page }) => {
    await storeGoogleTag({
      ga4MeasurementId: MEASUREMENT_ID,
      gtmContainerId: CONTAINER_ID,
      mode: "google",
    });
    // The catalogue loads the tag, so the pages below load none because they
    // are left out, not because the settings have yet to reach the site.
    await openUntilRequested(page, "/", gtmLoader(GOOGLE_TAG_ORIGIN));

    const requested = recordTagRequests(page);
    const expectNoTag = async (pathname: string) => {
      await page.goto(siteUrl(pathname));
      await settle(page);
      expect(requested, `${pathname} asks for no tag`).toEqual([]);
      expect(await hasDataLayer(page), `${pathname} starts no tag`).toBe(false);
    };

    await expectNoTag("/login");
    await expectNoTag("/signup");
    await expectNoTag("/reset-password");
    await expectNoTag("/resend-verification");

    await signInAsMember(
      page,
      STOREFRONT_GOOGLE_TAG_READER,
      "/settings/security",
      WEB_STOREFRONT_GOOGLE_TAG_BASE_URL
    );
    await expect(page).toHaveURL(siteUrl("/settings/security"));
    await settle(page);
    expect(
      requested,
      "signing in and landing on settings asks for no tag"
    ).toEqual([]);

    await expectNoTag("/settings");
    await expectNoTag("/settings/security");
  });
});

/** The tag the gateway forwards for: the container, which the tenant has too. */
const GATEWAY_TAG_HOST = `${CONTAINER_ID}.fps.goog`;

/** The forwarded path and query of a request, as a URL on the stand-in. */
const forwardedUrl = (request: GoogleTagGatewayRequest): URL =>
  new URL(request.url, GOOGLE_TAG_GATEWAY_BASE_URL);

const forwardedTo = (
  requests: GoogleTagGatewayRequest[],
  pathname: string
): GoogleTagGatewayRequest[] =>
  requests.filter((request) => forwardedUrl(request).pathname === pathname);

test.describe("the Google tag gateway on the site's own origin", () => {
  test.beforeAll(async () => {
    await resetGoogleTag();
  });

  test.afterAll(async () => {
    await resetGoogleTag();
  });

  test.beforeEach(async ({ context }) => {
    // Only Google's own origins stand in here: the gateway path reaches the
    // storefront, which forwards it.
    await standInGoogleOrigins(context);
    await storeGoogleTag({
      ga4MeasurementId: MEASUREMENT_ID,
      gtmContainerId: CONTAINER_ID,
      mode: "gateway",
    });
    await clearGoogleTagGatewayRequests();
  });

  test("the tag loads through the gateway path, and its hits reach the upstream", async ({
    page,
  }) => {
    await openUntilRequested(
      page,
      "/",
      gtmLoader(GATEWAY_ORIGIN),
      gtagLoader(GATEWAY_ORIGIN)
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as { __e2eGatewayTag?: { loaded: string[] } }
            ).__e2eGatewayTag?.loaded.toSorted() ?? []
        )
      )
      .toEqual([CONTAINER_ID, MEASUREMENT_ID].toSorted());

    await expect
      .poll(async () =>
        forwardedTo(
          await googleTagGatewayRequests(),
          `/${GATEWAY_PATH}/g/collect`
        )
          .map((request) => forwardedUrl(request).searchParams.get("tid"))
          // `openUntilRequested` may load the page more than once, and every
          // load sends its hits.
          .filter((tid, index, all) => all.indexOf(tid) === index)
          .toSorted()
      )
      .toEqual([CONTAINER_ID, MEASUREMENT_ID].toSorted());

    const forwarded = await googleTagGatewayRequests();
    const loaders = forwardedTo(forwarded, `/${GATEWAY_PATH}/`).map(
      (request) => request.url
    );
    expect(loaders).toEqual(
      expect.arrayContaining([
        `/${GATEWAY_PATH}/?id=${CONTAINER_ID}`,
        `/${GATEWAY_PATH}/?id=${MEASUREMENT_ID}`,
      ])
    );
    for (const request of forwarded) {
      expect(request.headers.host, request.url).toBe(GATEWAY_TAG_HOST);
    }
  });

  test("the site's cookies and a credential stay behind, and only Google's cookies come back", async ({
    context,
    page,
  }) => {
    const site = siteUrl("/");
    await context.addCookies([
      { name: "publira_web_storefront_auth", url: site, value: "e2e-sealed" },
      { name: "publira_e2e_marker", url: site, value: "kept" },
      { name: "_ga", url: site, value: "GA1.1.e2e-reader" },
    ]);
    // A page that loads no tag, so the only hit is the one sent below.
    await page.goto(siteUrl("/login"));

    const status = await page.evaluate(async (pathname) => {
      const response = await fetch(pathname, {
        body: "en=e2e_probe",
        credentials: "include",
        headers: {
          Authorization: "Bearer e2e-reader-token",
          "X-Forwarded-CountryRegion": "JP-13",
        },
        method: "POST",
      });
      return response.status;
    }, `/${GATEWAY_PATH}/g/collect?v=2&en=e2e_probe`);
    expect(status).toBe(204);

    const [probe] = forwardedTo(
      await googleTagGatewayRequests(),
      `/${GATEWAY_PATH}/g/collect`
    );
    expect(probe?.url).toBe(`/${GATEWAY_PATH}/g/collect?v=2&en=e2e_probe`);
    expect(probe?.body).toBe("en=e2e_probe");
    expect(probe?.headers.cookie).toBe("_ga=GA1.1.e2e-reader");
    expect(probe?.headers).not.toHaveProperty("authorization");
    expect(probe?.headers).not.toHaveProperty("x-forwarded-countryregion");
    expect(probe?.headers["x-forwarded-for"]).toMatch(/^[\d.:a-f]+$/u);

    const stored = await context.cookies(site);
    const cookies = Object.fromEntries(
      stored.map(({ name, value }) => [name, value])
    );
    expect(cookies).toMatchObject({
      FPLC: "e2e-stand-in",
      _ga: "GA1.1.e2e-stand-in",
      publira_e2e_marker: "kept",
      publira_web_storefront_auth: "e2e-sealed",
    });
    expect(cookies).not.toHaveProperty("e2e_stand_in");
  });

  test("a stale gateway path, and the path of a tenant in another mode, get the site's 404", async ({
    page,
  }) => {
    const stalePath = "_staleaaaaaaaaaaa";
    const stale = await page.goto(siteUrl(`/${stalePath}/?id=${CONTAINER_ID}`));
    expect(stale?.status()).toBe(404);

    await storeGoogleTag({
      ga4MeasurementId: MEASUREMENT_ID,
      gtmContainerId: CONTAINER_ID,
      mode: "google",
    });
    const otherMode = await page.goto(
      siteUrl(`/${GATEWAY_PATH}/?id=${CONTAINER_ID}`)
    );
    expect(otherMode?.status()).toBe(404);

    expect(await googleTagGatewayRequests()).toEqual([]);
  });
});
