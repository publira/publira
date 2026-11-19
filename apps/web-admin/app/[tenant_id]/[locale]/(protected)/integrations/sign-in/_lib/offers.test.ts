import { describe, expect, it } from "vitest";

import type { TenantSignInSettings } from "#lib/tenant-sign-in-settings";

import { signInOffers } from "./offers";

const WEB_CLIENT_ID = "123456789012-abc123.apps.googleusercontent.com";
const IOS_CLIENT_ID = "123456789012-def456.apps.googleusercontent.com";

const settings = (
  apple: Partial<TenantSignInSettings["apple"]>,
  google: Partial<TenantSignInSettings["google"]>
): TenantSignInSettings => ({
  apple: {
    bundleIdentifier: "",
    enabled: true,
    keyId: "2X9R4HXF34",
    privateKeyConfigured: true,
    privateKeyHint: "••••••••wIBAQQg",
    ready: true,
    servicesId: "",
    teamId: "ABCDE12345",
    ...apple,
  },
  google: {
    enabled: true,
    iosClientId: "",
    ready: true,
    webClientId: "",
    ...google,
  },
});

const offered = (offers: { surface: string; offered: boolean }[]) =>
  Object.fromEntries(offers.map(({ offered: on, surface }) => [surface, on]));

describe("signInOffers", () => {
  it("offers each provider everywhere when every client is saved", () => {
    const offers = signInOffers(
      settings(
        {
          bundleIdentifier: "com.example.reader",
          servicesId: "com.example.web",
        },
        { iosClientId: IOS_CLIENT_ID, webClientId: WEB_CLIENT_ID }
      ),
      "com.example.reader"
    );

    expect(offered(offers.apple)).toStrictEqual({
      android: true,
      ios: true,
      site: true,
    });
    expect(offered(offers.google)).toStrictEqual({
      android: true,
      ios: true,
      site: true,
    });
  });

  it("keeps Apple off the site and the Android app without a Services ID", () => {
    const offers = signInOffers(
      settings({ bundleIdentifier: "com.example.reader" }, { ready: false }),
      "com.example.reader"
    );

    expect(offered(offers.apple)).toStrictEqual({
      android: false,
      ios: true,
      site: false,
    });
  });

  it("keeps Apple out of the Android app while App links names none", () => {
    const offers = signInOffers(
      settings({ servicesId: "com.example.web" }, { ready: false }),
      ""
    );

    expect(offered(offers.apple)).toStrictEqual({
      android: false,
      ios: false,
      site: true,
    });
  });

  it("leaves Apple's Android row out when App links could not be read", () => {
    const offers = signInOffers(
      settings({ servicesId: "com.example.web" }, { ready: false })
    );

    expect(offers.apple.map(({ surface }) => surface)).toStrictEqual([
      "site",
      "ios",
    ]);
  });

  it("keeps Google off the site and the Android app without a Web client ID", () => {
    const offers = signInOffers(
      settings(
        { bundleIdentifier: "com.example.reader" },
        { iosClientId: IOS_CLIENT_ID }
      ),
      ""
    );

    expect(offered(offers.google)).toStrictEqual({
      android: false,
      ios: true,
      site: false,
    });
  });

  it("keeps Google out of the iOS app unless Apple is offered there", () => {
    const offers = signInOffers(
      settings(
        { bundleIdentifier: "com.example.reader", ready: false },
        { iosClientId: IOS_CLIENT_ID, webClientId: WEB_CLIENT_ID }
      ),
      ""
    );

    expect(offered(offers.google)).toStrictEqual({
      android: true,
      ios: false,
      site: true,
    });
  });

  it("offers nothing anywhere for a provider that is not ready", () => {
    const offers = signInOffers(
      settings(
        {
          bundleIdentifier: "com.example.reader",
          enabled: false,
          ready: false,
          servicesId: "com.example.web",
        },
        { enabled: false, ready: false, webClientId: WEB_CLIENT_ID }
      ),
      "com.example.reader"
    );

    expect(offers.apple.some(({ offered: on }) => on)).toBe(false);
    expect(offers.google.some(({ offered: on }) => on)).toBe(false);
  });
});
