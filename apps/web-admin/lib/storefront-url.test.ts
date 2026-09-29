import { afterEach, describe, expect, it, vi } from "vitest";

import { storefrontOrigin, tenantWebhookUrl } from "./storefront-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("storefrontOrigin", () => {
  it("defaults to https with no port", () => {
    vi.stubEnv("PUBLIRA_TENANT_URL_SCHEME", "");

    expect(storefrontOrigin("comics.example")).toBe("https://comics.example");
  });

  it("uses the deployment's scheme and a port saved on the domain", () => {
    vi.stubEnv("PUBLIRA_TENANT_URL_SCHEME", "http");

    expect(storefrontOrigin(" comics.example:3180 ")).toBe(
      "http://comics.example:3180"
    );
  });

  it("is absent when the tenant has no domain", () => {
    expect(storefrontOrigin("  ")).toBeUndefined();
  });
});

describe("tenantWebhookUrl", () => {
  it("names the provider's webhook on the storefront origin", () => {
    vi.stubEnv("PUBLIRA_TENANT_URL_SCHEME", "http");

    expect(tenantWebhookUrl("comics.example:3180", "app-store")).toBe(
      "http://comics.example:3180/api/v1/webhook/payment/app-store"
    );
  });

  it("is absent when the tenant has no domain", () => {
    expect(tenantWebhookUrl("", "stripe")).toBeUndefined();
  });
});
