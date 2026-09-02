// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { readClientLocale } from "./client-locale";

const RESOLVED_LOCALE_COOKIE = "publira_resolved_locale";

const visit = (pathname: string) => {
  window.history.replaceState({}, "", pathname);
};

const setCookie = (pair: string) => {
  document.cookie = `${pair}; path=/`;
};

const clearCookies = () => {
  for (const entry of document.cookie.split(";")) {
    const name = entry.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=; path=/; max-age=0`;
    }
  }
};

/**
 * `navigator.languages` is read-only, and the last case below is about what the
 * browser asked for when neither the path nor the cookie names a locale.
 */
const setBrowserLanguages = (...languages: string[]) => {
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: languages,
  });
};

afterEach(() => {
  clearCookies();
  visit("/");
});

describe("readClientLocale", () => {
  it("takes the locale the path names", () => {
    visit("/en/series/SR01");
    setCookie(`${RESOLVED_LOCALE_COOKIE}=ja`);

    expect(readClientLocale()).toBe("en");
  });

  it("takes the default the proxy published for an unprefixed path", () => {
    visit("/series/SR01");
    setCookie(`${RESOLVED_LOCALE_COOKIE}=ja`);

    expect(readClientLocale()).toBe("ja");
  });

  it("ignores a cookie naming a locale this build does not serve", () => {
    visit("/series");
    setCookie(`${RESOLVED_LOCALE_COOKIE}=fr`);
    setBrowserLanguages("en-US", "en");

    expect(readClientLocale()).toBe("en");
  });

  it("falls through to what the browser asked for when nothing names one", () => {
    visit("/series");
    setBrowserLanguages("ja-JP", "ja");

    expect(readClientLocale()).toBe("ja");
  });
});
