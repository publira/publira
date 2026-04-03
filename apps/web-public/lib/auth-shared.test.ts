import { describe, expect, it } from "vitest";

import { buildAuthUrl, buildLoginUrl } from "./auth-shared";

describe("web-public auth-shared", () => {
  it("buildLoginUrl は tenantPublicId ありでテナント login URL を返す", () => {
    const url = buildLoginUrl(
      new URL("https://public.example.com/series/abc?ref=top"),
      "TENANT001"
    );

    expect(url.pathname).toBe("/TENANT001/login");
    expect(url.searchParams.get("returnTo")).toBe("/series/abc?ref=top");
  });

  it("buildAuthUrl は returnTo を現在URLから構築する", () => {
    const authUrl = buildAuthUrl(
      new URL("https://public.example.com/catalog?page=2"),
      "TENANT001",
      "/signup"
    );

    expect(authUrl.pathname).toBe("/TENANT001/signup");
    expect(authUrl.searchParams.get("returnTo")).toBe("/catalog?page=2");
  });
});
