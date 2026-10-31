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
  STOREFRONT_GOOGLE_TAG_SERIES,
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

/** The page whose view the site counts. */
const SERIES_PATH = `/series/${STOREFRONT_GOOGLE_TAG_SERIES.publicId}`;

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

type ConsentMode = "external" | "not_required" | "opt_in";

/** The tag the storefront holds the tenant's Google tag read under. */
const analyticsSettingsTag = `tenant:${STOREFRONT_GOOGLE_TAG_TENANT.id}:analytics-settings`;

const sqlLiteral = (value: string | undefined): string =>
  value ? quoteSqlLiteral(value) : "NULL";

const storeGoogleTag = async ({
  consentMode = "not_required",
  ga4MeasurementId,
  gtmContainerId,
  mode,
}: {
  consentMode?: ConsentMode;
  ga4MeasurementId?: string;
  gtmContainerId?: string;
  mode: ServingMode;
}): Promise<void> => {
  runSql(`
    INSERT INTO tenant_analytics_settings (
      tenant_id, ga4_measurement_id, gtm_container_id, serving_mode,
      server_container_url, gateway_path, consent_mode
    )
    VALUES (
      '${STOREFRONT_GOOGLE_TAG_TENANT.id}',
      ${sqlLiteral(ga4MeasurementId)},
      ${sqlLiteral(gtmContainerId)},
      '${mode}',
      ${sqlLiteral(mode === "server_container" ? SERVER_CONTAINER_URL : undefined)},
      ${sqlLiteral(mode === "gateway" ? GATEWAY_PATH : undefined)},
      '${consentMode}'
    )
    ON CONFLICT (tenant_id) DO UPDATE
    SET ga4_measurement_id = EXCLUDED.ga4_measurement_id,
        gtm_container_id = EXCLUDED.gtm_container_id,
        serving_mode = EXCLUDED.serving_mode,
        server_container_url = EXCLUDED.server_container_url,
        gateway_path = EXCLUDED.gateway_path,
        consent_mode = EXCLUDED.consent_mode;
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

/**
 * The `consent` commands on the page's `dataLayer`, in the order given. A
 * command is an `arguments` object, which spreads; the container's start is
 * an event object beside them, which does not.
 */
const consentCommands = (page: Page): Promise<unknown[][]> =>
  page.evaluate(() =>
    (
      (
        window as unknown as {
          dataLayer?: (Iterable<unknown> & Record<number, unknown>)[];
        }
      ).dataLayer ?? []
    )
      .filter((entry) => entry[0] === "consent")
      .map((entry) => [...entry])
  );

const CONSENT_COOKIE = "publira_web_storefront_analytics_consent";
const VIEW_ACTOR_COOKIE = "publira_web_storefront_view_actor";

const signals = (answer: "denied" | "granted") => ({
  ad_personalization: answer,
  ad_storage: answer,
  ad_user_data: answer,
  analytics_storage: answer,
});

const CONSENT_DEFAULT = [
  "consent",
  "default",
  { ...signals("denied"), wait_for_update: 500 },
];

const consentBanner = (page: Page) =>
  page.getByRole("region", { name: "How this site is measured" });

const cookieSettings = (page: Page) =>
  page.getByRole("button", { exact: true, name: "Cookie settings" });

/** The view beacons the page sends, one entry per request. */
const recordViewBeacons = (page: Page): string[] => {
  const sent: string[] = [];
  page.on("request", (request: Request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/views"
    ) {
      sent.push(request.postData() ?? "");
    }
  });

  return sent;
};

const storedCookie = async (
  context: BrowserContext,
  name: string
): Promise<string | undefined> => {
  const cookies = await context.cookies(siteUrl("/"));

  return cookies.find((cookie) => cookie.name === name)?.value;
};

/**
 * Opens `pathname` until the page shows the consent banner, which only a
 * tenant that asks first draws: the first load after a change may still
 * render the previous settings, as {@link openUntilRequested} describes.
 */
const openUntilAsked = async (page: Page, pathname: string): Promise<void> => {
  await expect(async () => {
    await page.goto(siteUrl(pathname));
    await expect(consentBanner(page)).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30_000 });
};

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

  for (const consentMode of ["not_required", "external", "opt_in"] as const) {
    test(`the pages that take credentials load no tag and ask nothing (${consentMode})`, async ({
      page,
    }) => {
      await storeGoogleTag({
        consentMode,
        ga4MeasurementId: MEASUREMENT_ID,
        gtmContainerId: CONTAINER_ID,
        mode: "google",
      });
      // The catalogue loads the tag, or asks for consent first, so the pages
      // below do neither because they are left out, not because the settings
      // have yet to reach the site.
      await (consentMode === "opt_in"
        ? openUntilAsked(page, "/")
        : openUntilRequested(page, "/", gtmLoader(GOOGLE_TAG_ORIGIN)));

      const requested = recordTagRequests(page);

      const expectNothing = async (pathname: string) => {
        await page.goto(siteUrl(pathname));
        await settle(page);
        expect(requested, `${pathname} asks for no tag`).toEqual([]);
        expect(await hasDataLayer(page), `${pathname} starts no tag`).toBe(
          false
        );
        await expect(
          consentBanner(page),
          `${pathname} shows no banner`
        ).toHaveCount(0);
        await expect(cookieSettings(page)).toHaveCount(0);
      };

      await expectNothing("/login");
      await expectNothing("/signup");
      await expectNothing("/reset-password");
      await expectNothing("/resend-verification");

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

      await expectNothing("/settings");
      await expectNothing("/settings/security");
    });
  }

  test("a tenant that does not ask adds nothing of consent to the page", async ({
    page,
  }) => {
    await storeGoogleTag({
      ga4MeasurementId: MEASUREMENT_ID,
      gtmContainerId: CONTAINER_ID,
      mode: "google",
    });
    await openUntilRequested(page, "/", gtmLoader(GOOGLE_TAG_ORIGIN));

    const response = await page.goto(siteUrl(SERIES_PATH));
    const html = (await response?.text()) ?? "";
    await settle(page);

    expect(html).not.toContain("publira-gtag-consent");
    expect(html).not.toContain("gtag('consent'");
    expect(await consentCommands(page)).toEqual([]);
    await expect(consentBanner(page)).toHaveCount(0);
    await expect(cookieSettings(page)).toHaveCount(0);
  });
});

test.describe("a tenant that asks readers first", () => {
  test.beforeAll(async ({ browser }) => {
    await resetGoogleTag();
    await storeGoogleTag({
      consentMode: "opt_in",
      ga4MeasurementId: MEASUREMENT_ID,
      gtmContainerId: CONTAINER_ID,
      mode: "google",
    });
    // Waits in a browser of its own: a load that still renders the previous
    // settings runs the tag and counts the view, which would leave its
    // cookies behind in the browser a test then looks into.
    const context = await browser.newContext();
    await standInTagOrigins(context);
    await openUntilAsked(await context.newPage(), "/");
    await context.close();
  });

  test.afterAll(async () => {
    await resetGoogleTag();
  });

  test.beforeEach(async ({ context }) => {
    await standInTagOrigins(context);
  });

  test("a first visit asks, and nothing is requested, counted, or stored", async ({
    context,
    page,
  }) => {
    const requested = recordTagRequests(page);
    const beacons = recordViewBeacons(page);

    const response = await page.goto(siteUrl(SERIES_PATH));
    const html = (await response?.text()) ?? "";
    await expect(consentBanner(page)).toBeVisible();
    await expect(
      consentBanner(page).getByRole("button", { name: "Accept" })
    ).toBeVisible();
    await expect(
      consentBanner(page).getByRole("button", { name: "Decline" })
    ).toBeVisible();
    await settle(page);

    // The loader URLs travel to the page as data, but no element asks the
    // browser to fetch one ahead of the answer.
    expect(html).not.toMatch(/<link[^>]+googletagmanager/u);
    expect(requested).toEqual([]);
    expect(beacons).toEqual([]);
    expect(await storedCookie(context, VIEW_ACTOR_COOKIE)).toBeUndefined();
    expect(await storedCookie(context, CONSENT_COOKIE)).toBeUndefined();
    expect(await consentCommands(page)).toEqual([CONSENT_DEFAULT]);
  });

  test("accepting loads the tag, grants every signal, and counts the open page once", async ({
    context,
    page,
  }) => {
    const beacons = recordViewBeacons(page);
    await page.goto(siteUrl(SERIES_PATH));

    const loaders = Promise.all([
      page.waitForRequest(gtmLoader(GOOGLE_TAG_ORIGIN)),
      page.waitForRequest(gtagLoader(GOOGLE_TAG_ORIGIN)),
    ]);

    await consentBanner(page).getByRole("button", { name: "Accept" }).click();
    await loaders;
    await expect(consentBanner(page)).toHaveCount(0);
    await settle(page);

    expect(await consentCommands(page)).toEqual([
      CONSENT_DEFAULT,
      ["consent", "update", signals("granted")],
    ]);
    expect(beacons).toHaveLength(1);
    expect(await storedCookie(context, CONSENT_COOKIE)).toBe("granted");
    expect(await storedCookie(context, VIEW_ACTOR_COOKIE)).toBeDefined();

    const reloaded = page.waitForRequest(gtmLoader(GOOGLE_TAG_ORIGIN));
    await page.reload();
    await reloaded;
    await settle(page);
    await expect(consentBanner(page)).toHaveCount(0);
    expect(await consentCommands(page)).toEqual([
      CONSENT_DEFAULT,
      ["consent", "update", signals("granted")],
    ]);
  });

  test("declining requests nothing, counts nothing, and is remembered", async ({
    context,
    page,
  }) => {
    const requested = recordTagRequests(page);
    const beacons = recordViewBeacons(page);
    await page.goto(siteUrl(SERIES_PATH));

    await consentBanner(page).getByRole("button", { name: "Decline" }).click();
    await expect(consentBanner(page)).toHaveCount(0);
    await settle(page);

    expect(requested).toEqual([]);
    expect(beacons).toEqual([]);
    expect(await consentCommands(page)).toEqual([CONSENT_DEFAULT]);
    expect(await storedCookie(context, CONSENT_COOKIE)).toBe("denied");
    expect(await storedCookie(context, VIEW_ACTOR_COOKIE)).toBeUndefined();

    await page.reload();
    await settle(page);
    await expect(consentBanner(page)).toHaveCount(0);
    expect(requested).toEqual([]);
    expect(beacons).toEqual([]);
  });

  test("a browser with Global Privacy Control is not asked, and nothing is requested or stored", async ({
    context,
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "globalPrivacyControl", {
        get: () => true,
      });
    });
    const requested = recordTagRequests(page);
    const beacons = recordViewBeacons(page);

    await page.goto(siteUrl(SERIES_PATH));
    await expect(
      page.getByRole("heading", { name: STOREFRONT_GOOGLE_TAG_SERIES.title })
    ).toBeVisible();
    await settle(page);

    await expect(consentBanner(page)).toHaveCount(0);
    await expect(cookieSettings(page)).toHaveCount(0);
    expect(requested).toEqual([]);
    expect(beacons).toEqual([]);
    expect(await storedCookie(context, CONSENT_COOKIE)).toBeUndefined();
    expect(await storedCookie(context, VIEW_ACTOR_COOKIE)).toBeUndefined();
  });

  test("Cookie settings brings the banner back, and a changed answer is sent", async ({
    page,
  }) => {
    await page.goto(siteUrl(SERIES_PATH));
    await consentBanner(page).getByRole("button", { name: "Decline" }).click();
    await expect(consentBanner(page)).toHaveCount(0);

    await cookieSettings(page).click();
    await expect(consentBanner(page)).toBeVisible();
    const loaded = page.waitForRequest(gtmLoader(GOOGLE_TAG_ORIGIN));
    await consentBanner(page).getByRole("button", { name: "Accept" }).click();
    await loaded;
    expect(await consentCommands(page)).toEqual([
      CONSENT_DEFAULT,
      ["consent", "update", signals("granted")],
    ]);

    await cookieSettings(page).click();
    await consentBanner(page).getByRole("button", { name: "Decline" }).click();
    await expect(consentBanner(page)).toHaveCount(0);
    expect(await consentCommands(page)).toEqual([
      CONSENT_DEFAULT,
      ["consent", "update", signals("granted")],
      ["consent", "update", signals("denied")],
    ]);
  });

  test("a withdrawal in one tab reaches the tag already running in another", async ({
    context,
    page,
  }) => {
    await page.goto(siteUrl(SERIES_PATH));
    const loaded = page.waitForRequest(gtmLoader(GOOGLE_TAG_ORIGIN));
    await consentBanner(page).getByRole("button", { name: "Accept" }).click();
    await loaded;

    const other = await context.newPage();
    const otherLoaded = other.waitForRequest(gtmLoader(GOOGLE_TAG_ORIGIN));
    await other.goto(siteUrl(SERIES_PATH));
    await otherLoaded;

    await cookieSettings(page).click();
    await consentBanner(page).getByRole("button", { name: "Decline" }).click();

    await expect
      .poll(() => consentCommands(other))
      .toEqual([
        CONSENT_DEFAULT,
        ["consent", "update", signals("granted")],
        ["consent", "update", signals("denied")],
      ]);
  });

  test("a signed-in reader's view is counted under their account without an answer", async ({
    page,
  }) => {
    const beacons = recordViewBeacons(page);

    const counted = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v1/views"
    );

    await signInAsMember(
      page,
      STOREFRONT_GOOGLE_TAG_READER,
      SERIES_PATH,
      WEB_STOREFRONT_GOOGLE_TAG_BASE_URL
    );
    await counted;

    await expect(consentBanner(page)).toBeVisible();
    expect(beacons).toHaveLength(1);
  });
});

test.describe("a tenant whose own consent tool asks", () => {
  test.beforeAll(async () => {
    await resetGoogleTag();
    await storeGoogleTag({
      consentMode: "external",
      ga4MeasurementId: MEASUREMENT_ID,
      gtmContainerId: CONTAINER_ID,
      mode: "google",
    });
  });

  test.afterAll(async () => {
    await resetGoogleTag();
  });

  test.beforeEach(async ({ context }) => {
    await standInTagOrigins(context);
  });

  test("the tag loads with every signal denied first, and the site shows no banner", async ({
    page,
  }) => {
    await expect(async () => {
      const requested = page.waitForRequest(gtmLoader(GOOGLE_TAG_ORIGIN), {
        timeout: 5000,
      });

      await page.goto(siteUrl(SERIES_PATH));
      await requested;
      expect(await consentCommands(page)).toEqual([CONSENT_DEFAULT]);
    }).toPass({ timeout: 30_000 });
    await settle(page);

    // A command is an `arguments` object and the container's start an event
    // object, so each is named by what it is.
    const order = await page.evaluate(() =>
      (
        window as unknown as { dataLayer: Record<string, unknown>[] }
      ).dataLayer.map((entry) =>
        entry[0] === "consent" ? "consent" : entry.event
      )
    );

    expect(order.indexOf("consent")).toBeLessThan(order.indexOf("gtm.js"));
    await expect(consentBanner(page)).toHaveCount(0);
    await expect(cookieSettings(page)).toHaveCount(0);
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
        headers: { Authorization: "Bearer e2e-reader-token" },
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
    // The page named no region, so the edge handed the storefront none, and
    // the gateway sends none of its own.
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

  test("the reader's region the edge hands over reaches the upstream", async ({
    page,
  }) => {
    // A page that loads no tag, so the only hit is the one sent below.
    await page.goto(siteUrl("/login"));

    // The E2E edge trusts the page as it would a CDN in front of it that
    // looks up the reader's region, so the header the page sends is the one
    // such a hop sets, and the edge hands it on to the storefront.
    const status = await page.evaluate(async (pathname) => {
      const response = await fetch(pathname, {
        body: "en=e2e_region",
        headers: { "X-Forwarded-CountryRegion": "JP-13" },
        method: "POST",
      });

      return response.status;
    }, `/${GATEWAY_PATH}/g/collect?v=2&en=e2e_region`);

    expect(status).toBe(204);

    const [probe] = forwardedTo(
      await googleTagGatewayRequests(),
      `/${GATEWAY_PATH}/g/collect`
    );

    expect(probe?.body).toBe("en=e2e_region");
    expect(probe?.headers["x-forwarded-countryregion"]).toBe("JP-13");
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
