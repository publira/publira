import { LOCALE_COOKIE_NAME, RESOLVED_LOCALE_COOKIE_NAME } from "@publira/i18n";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  suspendedTenantLocale,
  suspendedTenantResponse,
} from "./suspended-tenant";

const chosen = (locale: string) => `${LOCALE_COOKIE_NAME}=${locale}`;
const published = (locale: string) =>
  `${RESOLVED_LOCALE_COOKIE_NAME}=${locale}`;

const request = (headers: Record<string, string> = {}) =>
  new NextRequest("https://comics.example.com/series", { headers });

describe("suspendedTenantLocale", () => {
  it("writes the page in the language the URL names", () => {
    expect(
      suspendedTenantLocale(
        request({ "accept-language": "ja", cookie: chosen("ko") }),
        "zh-Hant"
      )
    ).toBe("zh-Hant");
  });

  it("prefers the visitor's choice to the default the console published", () => {
    expect(
      suspendedTenantLocale(
        request({ cookie: `${chosen("ko")}; ${published("ja")}` })
      )
    ).toBe("ko");
  });

  it("falls back to the default the console last published for this host", () => {
    expect(
      suspendedTenantLocale(
        request({
          "accept-language": "ko",
          cookie: published("ja"),
        })
      )
    ).toBe("ja");
  });

  it("negotiates from Accept-Language when no cookie names a locale", () => {
    expect(
      suspendedTenantLocale(
        request({ "accept-language": "ko-KR,ko;q=0.9", cookie: "x=1" })
      )
    ).toBe("ko");
    expect(suspendedTenantLocale(request())).toBe("en");
  });
});

describe("suspendedTenantResponse", () => {
  it("answers 503 with a page no cache keeps past a resume", async () => {
    const response = suspendedTenantResponse({
      description: "Please come back later.",
      locale: "en",
      title: "This site is unavailable",
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-language")).toBe("en");
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8"
    );
    expect(response.headers.get("retry-after")).toBeNull();

    const html = await response.text();
    expect(html).toMatch(/^<!doctype html><html lang="en">/u);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain("<title>This site is unavailable</title>");
    expect(html).toContain("<h1>This site is unavailable</h1>");
    expect(html).toContain("<p>Please come back later.</p>");
  });

  it("escapes the copy it is handed", async () => {
    const response = suspendedTenantResponse({
      description: `"Tom" & 'Jerry'`,
      locale: "en",
      title: "<script>alert(1)</script>",
    });

    const html = await response.text();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&quot;Tom&quot; &amp; &#39;Jerry&#39;");
  });
});
