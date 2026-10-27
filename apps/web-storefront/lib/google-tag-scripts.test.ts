import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  googleTagScripts,
  gtagConsentDefaultScript,
  gtagInitScript,
  loadsGoogleTagOn,
} from "./google-tag-scripts";
import type { GoogleTagServing } from "./google-tag-scripts";

const ORIGIN = "https://comics.example.com";

const both = (serving: GoogleTagServing) => ({
  consentMode: "not_required" as const,
  ga4MeasurementId: "G-ABC123DEF4",
  gtmContainerId: "GTM-ABC1234",
  serving,
});

describe("googleTagScripts", () => {
  it("loads both tags from Google in the google mode", () => {
    expect(googleTagScripts(both({ mode: "google" }), null)).toEqual({
      ga4: {
        measurementId: "G-ABC123DEF4",
        src: "https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4",
      },
      gtm: { containerId: "GTM-ABC1234" },
    });
  });

  it("loads both tags from the server container and sends GA4's hits there", () => {
    expect(
      googleTagScripts(
        both({
          mode: "server_container",
          serverContainerUrl: "https://sgtm.example.com",
        }),
        null
      )
    ).toEqual({
      ga4: {
        config: { server_container_url: "https://sgtm.example.com" },
        measurementId: "G-ABC123DEF4",
        src: "https://sgtm.example.com/gtag/js?id=G-ABC123DEF4",
      },
      gtm: {
        containerId: "GTM-ABC1234",
        scriptUrl: "https://sgtm.example.com/gtm.js",
      },
    });
  });

  it("loads both tags from the gateway path on the storefront's own origin", () => {
    expect(
      googleTagScripts(
        both({ gatewayPath: "_abcdefghijklmnop", mode: "gateway" }),
        ORIGIN
      )
    ).toEqual({
      ga4: {
        measurementId: "G-ABC123DEF4",
        src: "https://comics.example.com/_abcdefghijklmnop/?id=G-ABC123DEF4",
      },
      gtm: {
        containerId: "GTM-ABC1234",
        scriptUrl: "https://comics.example.com/_abcdefghijklmnop/",
      },
    });
  });

  it("loads nothing through a gateway whose origin is unknown", () => {
    expect(
      googleTagScripts(
        both({ gatewayPath: "_abcdefghijklmnop", mode: "gateway" }),
        null
      )
    ).toBeNull();
  });

  it("loads only the tag the tenant has an ID for", () => {
    expect(
      googleTagScripts(
        {
          consentMode: "not_required",
          ga4MeasurementId: "",
          gtmContainerId: "GTM-ABC1234",
          serving: { mode: "google" },
        },
        null
      )
    ).toEqual({ gtm: { containerId: "GTM-ABC1234" } });
    expect(
      googleTagScripts(
        {
          consentMode: "not_required",
          ga4MeasurementId: "G-ABC123DEF4",
          gtmContainerId: "",
          serving: { mode: "google" },
        },
        null
      )
    ).toEqual({
      ga4: {
        measurementId: "G-ABC123DEF4",
        src: "https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4",
      },
    });
  });
});

describe("loadsGoogleTagOn", () => {
  it.each([
    "/login",
    "/signup",
    "/signup/continue",
    "/signup/pending",
    "/reset-password",
    "/reset-password/requested",
    "/confirm-password",
    "/confirm-email",
    "/verify",
    "/resend-verification",
    "/resend-verification/requested",
    "/settings",
    "/settings/security",
    "/settings/agreement",
  ])("leaves the tag off %s", (path) => {
    expect(loadsGoogleTagOn(path)).toBe(false);
  });

  it.each([
    "/",
    "/series/01HSERIES",
    "/my",
    "/my/library",
    "/notifications",
    "/loginhelp",
    "/settingsguide",
  ])("loads the tag on %s", (path) => {
    expect(loadsGoogleTagOn(path)).toBe(true);
  });
});

describe("gtagInitScript", () => {
  it("starts gtag.js with the measurement ID and its config", () => {
    expect(
      gtagInitScript({
        config: { server_container_url: "https://sgtm.example.com" },
        measurementId: "G-ABC123DEF4",
        src: "https://sgtm.example.com/gtag/js?id=G-ABC123DEF4",
      })
    ).toBe(
      'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag(\'js\',new Date());gtag(\'config\',"G-ABC123DEF4",{"server_container_url":"https://sgtm.example.com"});'
    );
  });

  it("cannot close the script element whatever the value holds", () => {
    expect(
      gtagInitScript({
        measurementId: "</script><script>alert(1)</script>",
        src: "https://www.googletagmanager.com/gtag/js",
      })
    ).not.toContain("<");
  });
});

/** What `script` leaves in the `dataLayer` of a page holding `cookie`. */
const runConsentScript = (
  script: string,
  { cookie = "", gpc = false }: { cookie?: string; gpc?: boolean } = {}
): unknown[][] => {
  const page: Record<string, unknown> = {
    document: { cookie },
    navigator: { globalPrivacyControl: gpc },
  };
  page.window = page;
  runInNewContext(script, page);
  return (page.dataLayer as Iterable<unknown>[]).map((entry) => [...entry]);
};

describe("gtagConsentDefaultScript", () => {
  const COOKIE = "publira_web_storefront_analytics_consent";

  const denied = {
    ad_personalization: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    analytics_storage: "denied",
  };
  const granted = {
    ad_personalization: "granted",
    ad_storage: "granted",
    ad_user_data: "granted",
    analytics_storage: "granted",
  };

  it("denies every signal by default and waits briefly for an update", () => {
    expect(runConsentScript(gtagConsentDefaultScript(null))).toEqual([
      ["consent", "default", { ...denied, wait_for_update: 500 }],
    ]);
  });

  it("restores a stored grant straight after the default", () => {
    expect(
      runConsentScript(gtagConsentDefaultScript(COOKIE), {
        cookie: `other=1; ${COOKIE}=granted`,
      })
    ).toEqual([
      ["consent", "default", { ...denied, wait_for_update: 500 }],
      ["consent", "update", granted],
    ]);
  });

  it.each([
    ["no answer", ""],
    ["a refusal", `${COOKIE}=denied`],
    ["another cookie that ends in the name", `x${COOKIE}=granted`],
  ])("sends no update for %s", (_, cookie) => {
    expect(
      runConsentScript(gtagConsentDefaultScript(COOKIE), { cookie })
    ).toHaveLength(1);
  });

  it("sends no update to a browser with Global Privacy Control, whatever is stored", () => {
    expect(
      runConsentScript(gtagConsentDefaultScript(COOKIE), {
        cookie: `${COOKIE}=granted`,
        gpc: true,
      })
    ).toHaveLength(1);
  });

  it("cannot close the script element whatever the cookie name holds", () => {
    expect(gtagConsentDefaultScript("</script>")).not.toContain("<");
  });
});
