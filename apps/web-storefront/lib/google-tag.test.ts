import { Code, ConnectError } from "@publira/api-client/errors";
import {
  GoogleTagConsentMode,
  GoogleTagServingMode,
} from "@publira/api-client/public/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheLife, mockCacheTag, mockGetTenantAnalyticsSettings } =
  vi.hoisted(() => ({
    mockCacheLife: vi.fn(),
    mockCacheTag: vi.fn(),
    mockGetTenantAnalyticsSettings: vi.fn(),
  }));

// The read runs without the Next.js cache runtime here, so the `"use cache"`
// helpers are stubbed rather than exercised.
vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    tenant: { getTenantAnalyticsSettings: mockGetTenantAnalyticsSettings },
  },
}));

const { getTenantGoogleTag } = await import("./google-tag");

describe("getTenantGoogleTag", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockGetTenantAnalyticsSettings.mockReset();
  });

  it("answers the tenant's IDs and serving mode", async () => {
    mockGetTenantAnalyticsSettings.mockResolvedValueOnce({
      googleTag: {
        consentMode: GoogleTagConsentMode.NOT_REQUIRED,
        ga4MeasurementId: "G-ABC123DEF4",
        gatewayPath: "",
        gtmContainerId: "GTM-ABC1234",
        serverContainerUrl: "https://sgtm.example.com",
        servingMode: GoogleTagServingMode.SERVER_CONTAINER,
      },
    });

    await expect(getTenantGoogleTag(" TENANT001 ")).resolves.toEqual({
      consentMode: "not_required",
      ga4MeasurementId: "G-ABC123DEF4",
      gtmContainerId: "GTM-ABC1234",
      serving: {
        mode: "server_container",
        serverContainerUrl: "https://sgtm.example.com",
      },
    });
    expect(mockGetTenantAnalyticsSettings).toHaveBeenCalledWith({
      tenant: { tenantId: "TENANT001" },
    });
  });

  it("carries the tag the console's save drops", async () => {
    mockGetTenantAnalyticsSettings.mockResolvedValueOnce({});

    await getTenantGoogleTag("TENANT001");

    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:analytics-settings"
    );
  });

  it("answers no tag for a tenant that has set no ID", async () => {
    mockGetTenantAnalyticsSettings.mockResolvedValueOnce({});

    await expect(getTenantGoogleTag("TENANT001")).resolves.toBeNull();
  });

  it("answers no tag for a mode this build does not know", async () => {
    mockGetTenantAnalyticsSettings.mockResolvedValueOnce({
      googleTag: {
        consentMode: GoogleTagConsentMode.NOT_REQUIRED,
        ga4MeasurementId: "G-ABC123DEF4",
        gatewayPath: "",
        gtmContainerId: "",
        serverContainerUrl: "",
        servingMode: GoogleTagServingMode.UNSPECIFIED,
      },
    });

    await expect(getTenantGoogleTag("TENANT001")).resolves.toBeNull();
  });

  it.each([
    [GoogleTagConsentMode.UNSPECIFIED, "not_required"],
    [GoogleTagConsentMode.NOT_REQUIRED, "not_required"],
    [GoogleTagConsentMode.OPT_IN, "opt_in"],
    [GoogleTagConsentMode.EXTERNAL, "external"],
  ] as const)(
    "answers consent mode %s as %s, the unset one being what a server from before the setting sends",
    async (consentMode, expected) => {
      mockGetTenantAnalyticsSettings.mockResolvedValueOnce({
        googleTag: {
          consentMode,
          ga4MeasurementId: "",
          gatewayPath: "",
          gtmContainerId: "GTM-ABC1234",
          serverContainerUrl: "",
          servingMode: GoogleTagServingMode.GOOGLE,
        },
      });

      await expect(getTenantGoogleTag("TENANT001")).resolves.toMatchObject({
        consentMode: expected,
      });
    }
  );

  it("answers no tag for a consent mode this build does not know", async () => {
    mockGetTenantAnalyticsSettings.mockResolvedValueOnce({
      googleTag: {
        // SAFETY: a mode a newer server sends, which the generated enum does
        // not name yet — the case under test.
        consentMode: 99 as GoogleTagConsentMode,
        ga4MeasurementId: "",
        gatewayPath: "",
        gtmContainerId: "GTM-ABC1234",
        serverContainerUrl: "",
        servingMode: GoogleTagServingMode.GOOGLE,
      },
    });

    await expect(getTenantGoogleTag("TENANT001")).resolves.toBeNull();
  });

  it("answers no tag for a gateway without its path", async () => {
    mockGetTenantAnalyticsSettings.mockResolvedValueOnce({
      googleTag: {
        consentMode: GoogleTagConsentMode.NOT_REQUIRED,
        ga4MeasurementId: "",
        gatewayPath: "",
        gtmContainerId: "GTM-ABC1234",
        serverContainerUrl: "",
        servingMode: GoogleTagServingMode.GATEWAY,
      },
    });

    await expect(getTenantGoogleTag("TENANT001")).resolves.toBeNull();
  });

  it("loads no tag while the API is unavailable, and keeps that out of the cache", async () => {
    mockGetTenantAnalyticsSettings.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );

    await expect(getTenantGoogleTag("TENANT001")).resolves.toBeNull();
    expect(mockCacheLife).toHaveBeenLastCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});
