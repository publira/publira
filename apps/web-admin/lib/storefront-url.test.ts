import { afterEach, describe, expect, it, vi } from "vitest";

import {
  signInCallbackUrl,
  storefrontOrigin,
  tenantWebhookUrl,
} from "./storefront-url";

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

describe("signInCallbackUrl", () => {
  it("names each provider's callback on the storefront origin", () => {
    vi.stubEnv("PUBLIRA_TENANT_URL_SCHEME", "");

    expect(signInCallbackUrl("comics.example", "apple")).toBe(
      "https://comics.example/api/v1/auth/apple/callback"
    );
    expect(signInCallbackUrl("comics.example", "google")).toBe(
      "https://comics.example/api/v1/auth/google/callback"
    );
  });

  it("keeps the deployment's scheme and the domain's port", () => {
    vi.stubEnv("PUBLIRA_TENANT_URL_SCHEME", "http");

    expect(signInCallbackUrl("comics.example:3180", "google")).toBe(
      "http://comics.example:3180/api/v1/auth/google/callback"
    );
  });

  it("is absent when the tenant has no domain", () => {
    expect(signInCallbackUrl("", "apple")).toBeUndefined();
  });
});
