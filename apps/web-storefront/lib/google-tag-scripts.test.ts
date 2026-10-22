import { describe, expect, it } from "vitest";

import {
  googleTagScripts,
  gtagInitScript,
  loadsGoogleTagOn,
} from "./google-tag-scripts";
import type { GoogleTagServing } from "./google-tag-scripts";

const ORIGIN = "https://comics.example.com";

const both = (serving: GoogleTagServing) => ({
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
