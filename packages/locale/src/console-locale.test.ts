import { LOCALE_COOKIE_NAME } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { describe, expect, it } from "vitest";

import { consoleLocalePathname, consoleRequestLocale } from "./console-locale";

const request = (cookie?: string) => ({
  cookies: {
    get: (name: string) =>
      name === LOCALE_COOKIE_NAME && cookie !== undefined
        ? { value: cookie }
        : undefined,
  },
});

describe("consoleRequestLocale", () => {
  it("prefers a supported cookie over the stored default", () => {
    expect(consoleRequestLocale(request("en"), "ja")).toBe("en");
  });

  it("uses the stored default when the cookie is missing", () => {
    expect(consoleRequestLocale(request(), "ja")).toBe("ja");
  });

  it("uses the stored default when the cookie is not a locale", () => {
    expect(consoleRequestLocale(request("fr"), "ja")).toBe("ja");
    expect(consoleRequestLocale(request("  en  "), "ja")).toBe("en");
  });

  it("returns null when neither the cookie nor the stored default names a locale", () => {
    const stored: Locale | null = null;

    expect(consoleRequestLocale(request(), stored)).toBeNull();
    expect(consoleRequestLocale(request("fr"), stored)).toBeNull();
  });
});

describe("consoleLocalePathname", () => {
  it("prefixes a platform path with the locale", () => {
    expect(consoleLocalePathname("/tenants", "en")).toBe("/en/tenants");
    expect(consoleLocalePathname("/", "ja")).toBe("/ja");
  });

  it("prefixes an admin path with the tenant id and the locale", () => {
    expect(consoleLocalePathname("/series", "en", "tenant")).toBe(
      "/tenant/en/series"
    );
    expect(consoleLocalePathname("/", "ja", "tenant")).toBe("/tenant/ja");
  });
});
