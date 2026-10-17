import { describe, expect, it } from "vitest";

import {
  fallbackLanguage,
  publishedLocalesFrom,
  servedLocaleFrom,
} from "./served-locale";

describe("servedLocaleFrom", () => {
  it("keeps a locale the registry knows", () => {
    expect(servedLocaleFrom("ja", "en")).toBe("ja");
  });

  it("reads an unknown or missing locale as the requested one", () => {
    expect(servedLocaleFrom("xx", "en")).toBe("en");
    expect(servedLocaleFrom("", "ko")).toBe("ko");
    expect(servedLocaleFrom(undefined, "ja")).toBe("ja");
  });
});

describe("publishedLocalesFrom", () => {
  it("keeps the order the read named, without unknown or repeated codes", () => {
    expect(publishedLocalesFrom(["en", "xx", "ja", "en"], "en")).toEqual([
      "en",
      "ja",
    ]);
  });

  it("adds the served locale when the read left it out", () => {
    expect(publishedLocalesFrom(["en"], "ko")).toEqual(["en", "ko"]);
    expect(publishedLocalesFrom(undefined, "ja")).toEqual(["ja"]);
  });
});

describe("fallbackLanguage", () => {
  it("names the served language when the reader asked for another", () => {
    expect(fallbackLanguage("ja", "en")).toBe("English");
    expect(fallbackLanguage("en", "ja")).toBe("日本語");
  });

  it("is absent when the requested translation was served", () => {
    expect(fallbackLanguage("en", "en")).toBeNull();
  });
});
