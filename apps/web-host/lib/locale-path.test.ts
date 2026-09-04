import { describe, expect, it } from "vitest";

import {
  isLocaleExemptPathname,
  splitLocalePathname,
  toBarePathname,
  withLocalePrefix,
} from "./locale-path";

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("splitLocalePathname", () => {
  it("Detach the first locale", () => {
    expect(splitLocalePathname("/ja/series/SR01")).toEqual({
      locale: "ja",
      pathname: "/series/SR01",
    });
    expect(splitLocalePathname("/en")).toEqual({
      locale: "en",
      pathname: "/",
    });
  });

  it("For paths with no locale, set locale to null and return the entire path.", () => {
    expect(splitLocalePathname("/series/SR01")).toEqual({
      locale: null,
      pathname: "/series/SR01",
    });
    expect(splitLocalePathname("/")).toEqual({ locale: null, pathname: "/" });
    // An unsupported locale code is not a locale either.
    expect(splitLocalePathname("/fr/series")).toEqual({
      locale: null,
      pathname: "/fr/series",
    });
  });
});

describe("withLocalePrefix", () => {
  it("Omit the prefix of the default locale and add only the non-default locale", () => {
    expect(withLocalePrefix("ja", "ja", "/series")).toBe("/series");
    expect(withLocalePrefix("en", "ja", "/")).toBe("/en");
    expect(withLocalePrefix("ja", "ja", "/settings?tab=1#top")).toBe(
      "/settings?tab=1#top"
    );
    expect(withLocalePrefix("ja", "en", "/settings")).toBe("/ja/settings");
  });

  it("Return hrefs that go outside the app as is", () => {
    expect(withLocalePrefix("ja", "ja", "https://example.com/series")).toBe(
      "https://example.com/series"
    );
    expect(withLocalePrefix("ja", "ja", "//example.com")).toBe("//example.com");
    expect(withLocalePrefix("ja", "ja", "#section")).toBe("#section");
  });
});

describe("toBarePathname", () => {
  it("Get the same raw path both after rewrite and from public URL", () => {
    expect(toBarePathname(`/${TENANT_ID}/ja/settings/follows`)).toBe(
      "/settings/follows"
    );
    expect(toBarePathname("/ja/settings/follows")).toBe("/settings/follows");
    expect(toBarePathname("/ja")).toBe("/");
  });
});

describe("isLocaleExemptPathname", () => {
  it("Only paths that process outside the locale are true", () => {
    expect(isLocaleExemptPathname("/theme.css")).toBe(true);
    expect(isLocaleExemptPathname("/api/v1/revalidate")).toBe(true);
    expect(isLocaleExemptPathname("/ja/series")).toBe(false);
    expect(isLocaleExemptPathname("/")).toBe(false);
  });
});
