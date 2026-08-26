import { describe, expect, it } from "vitest";

import {
  isLocaleExemptPathname,
  splitLocalePathname,
  toBarePathname,
  withLocalePrefix,
} from "./locale-path";

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("splitLocalePathname", () => {
  it("先頭のロケールを切り離す", () => {
    expect(splitLocalePathname("/ja/series/SR01")).toEqual({
      locale: "ja",
      pathname: "/series/SR01",
    });
    expect(splitLocalePathname("/en")).toEqual({
      locale: "en",
      pathname: "/",
    });
  });

  it("ロケールが無いパスは locale を null にして丸ごと返す", () => {
    expect(splitLocalePathname("/series/SR01")).toEqual({
      locale: null,
      pathname: "/series/SR01",
    });
    expect(splitLocalePathname("/")).toEqual({ locale: null, pathname: "/" });
    // 未対応のロケールコードも「ロケールではない」として扱う。
    expect(splitLocalePathname("/fr/series")).toEqual({
      locale: null,
      pathname: "/fr/series",
    });
  });
});

describe("withLocalePrefix", () => {
  it("アプリ内パスにロケールを付ける", () => {
    expect(withLocalePrefix("ja", "/series")).toBe("/ja/series");
    expect(withLocalePrefix("en", "/")).toBe("/en");
    expect(withLocalePrefix("ja", "/settings?tab=1#top")).toBe(
      "/ja/settings?tab=1#top"
    );
  });

  it("アプリ外へ出る href はそのまま返す", () => {
    expect(withLocalePrefix("ja", "https://example.com/series")).toBe(
      "https://example.com/series"
    );
    expect(withLocalePrefix("ja", "//example.com")).toBe("//example.com");
    expect(withLocalePrefix("ja", "#section")).toBe("#section");
  });
});

describe("toBarePathname", () => {
  it("rewrite 後と公開 URL のどちらからも同じ素のパスを得る", () => {
    expect(toBarePathname(`/${TENANT_ID}/ja/settings/follows`)).toBe(
      "/settings/follows"
    );
    expect(toBarePathname("/ja/settings/follows")).toBe("/settings/follows");
    expect(toBarePathname("/ja")).toBe("/");
  });
});

describe("isLocaleExemptPathname", () => {
  it("ロケールの外で処理するパスだけを真とする", () => {
    expect(isLocaleExemptPathname("/theme.css")).toBe(true);
    expect(isLocaleExemptPathname("/api/revalidate")).toBe(true);
    expect(isLocaleExemptPathname("/ja/series")).toBe(false);
    expect(isLocaleExemptPathname("/")).toBe(false);
  });
});
