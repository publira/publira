import {
  GoogleTagConsentMode,
  GoogleTagServingMode,
} from "@publira/api-client/admin/types";
import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateTenantAnalyticsSettingsInput } from "./tenant-analytics-settings";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantAnalyticsSettingsApi,
  mockUpdateTenantAnalyticsSettingsApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantAnalyticsSettingsApi: vi.fn(),
  mockUpdateTenantAnalyticsSettingsApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    tenantSettings: {
      getTenantAnalyticsSettings: mockGetTenantAnalyticsSettingsApi,
      updateTenantAnalyticsSettings: mockUpdateTenantAnalyticsSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const fieldViolation = (field: string) =>
  new ConnectError("rejected", Code.InvalidArgument, undefined, [
    { desc: BadRequestSchema, value: { fieldViolations: [{ field }] } },
  ]);

const UNREADABLE = {
  expire: 0,
  revalidate: 0,
  stale: 0,
};

const updateInput = (
  settings: Partial<UpdateTenantAnalyticsSettingsInput["settings"]> = {},
  regenerateGatewayPath = false
): UpdateTenantAnalyticsSettingsInput => ({
  regenerateGatewayPath,
  settings: {
    consentMode: "not_required",
    ga4MeasurementId: "G-ABC123",
    gtmContainerId: "",
    serverContainerUrl: "",
    servingMode: "google",
    ...settings,
  },
  tenantId: "TENANT001",
});

describe("tenant-analytics-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads the settings under the tenant's tag", async () => {
    mockGetTenantAnalyticsSettingsApi.mockResolvedValueOnce({
      settings: {
        consentMode: GoogleTagConsentMode.OPT_IN,
        ga4MeasurementId: "G-ABC123",
        gatewayPath: "_abcdefghijklmnop",
        gtmContainerId: "GTM-XYZ789",
        serverContainerUrl: "https://sgtm.example.com",
        servingMode: GoogleTagServingMode.GATEWAY,
      },
    });

    const { getTenantAnalyticsSettings } =
      await import("./tenant-analytics-settings");

    const result = await getTenantAnalyticsSettings("TENANT001", "en");

    expect(result).toEqual({
      ok: true,
      settings: {
        consentMode: "opt_in",
        ga4MeasurementId: "G-ABC123",
        gatewayPath: "_abcdefghijklmnop",
        gtmContainerId: "GTM-XYZ789",
        serverContainerUrl: "https://sgtm.example.com",
        servingMode: "gateway",
      },
    });
    expect(mockGetTenantAnalyticsSettingsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:analytics-settings"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it.each([
    [GoogleTagServingMode.GOOGLE, "google"],
    [GoogleTagServingMode.SERVER_CONTAINER, "server_container"],
    [GoogleTagServingMode.GATEWAY, "gateway"],
  ])("reads serving mode %s as %s", async (servingMode, expected) => {
    mockGetTenantAnalyticsSettingsApi.mockResolvedValueOnce({
      settings: { servingMode },
    });

    const { getTenantAnalyticsSettings } =
      await import("./tenant-analytics-settings");

    const result = await getTenantAnalyticsSettings("TENANT001", "en");

    expect(result).toMatchObject({
      ok: true,
      settings: { servingMode: expected },
    });
  });

  it.each([
    [GoogleTagConsentMode.NOT_REQUIRED, "not_required"],
    [GoogleTagConsentMode.OPT_IN, "opt_in"],
    [GoogleTagConsentMode.EXTERNAL, "external"],
    // The server of the release before has no consent mode, and runs the tag
    // without asking.
    [GoogleTagConsentMode.UNSPECIFIED, "not_required"],
  ])("reads consent mode %s as %s", async (consentMode, expected) => {
    mockGetTenantAnalyticsSettingsApi.mockResolvedValueOnce({
      settings: { consentMode, servingMode: GoogleTagServingMode.GOOGLE },
    });

    const { getTenantAnalyticsSettings } =
      await import("./tenant-analytics-settings");

    const result = await getTenantAnalyticsSettings("TENANT001", "en");

    expect(result).toMatchObject({
      ok: true,
      settings: { consentMode: expected },
    });
  });

  // An unnamed mode is not "Google": showing it as the tenant's choice would
  // let a save write a mode nobody picked.
  it("reports an answer that names no serving mode as a failed read", async () => {
    mockGetTenantAnalyticsSettingsApi.mockResolvedValueOnce({
      settings: { servingMode: GoogleTagServingMode.UNSPECIFIED },
    });

    const { getTenantAnalyticsSettings } =
      await import("./tenant-analytics-settings");

    const result = await getTenantAnalyticsSettings("TENANT001", "en");

    expect(result).toEqual({
      message:
        "Could not load the Google tag settings. Please try again later.",
      ok: false,
      requiresSignIn: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith(UNREADABLE);
  });

  it("asks for a sign-in when there is no session", async () => {
    mockGetAccessToken.mockResolvedValueOnce("");

    const { getTenantAnalyticsSettings } =
      await import("./tenant-analytics-settings");

    const result = await getTenantAnalyticsSettings("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockGetTenantAnalyticsSettingsApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith(UNREADABLE);
  });

  it("reports a read the API could not answer", async () => {
    mockGetTenantAnalyticsSettingsApi.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );

    const { getTenantAnalyticsSettings } =
      await import("./tenant-analytics-settings");

    const result = await getTenantAnalyticsSettings("TENANT001", "en");

    expect(result).toMatchObject({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith(UNREADABLE);
  });

  it("writes every field but the gateway path, and the regeneration", async () => {
    mockUpdateTenantAnalyticsSettingsApi.mockResolvedValueOnce({
      settings: {
        consentMode: GoogleTagConsentMode.EXTERNAL,
        ga4MeasurementId: "",
        gatewayPath: "_qrstuvwxyz234567",
        gtmContainerId: "GTM-XYZ789",
        serverContainerUrl: "https://sgtm.example.com",
        servingMode: GoogleTagServingMode.GATEWAY,
      },
    });

    const { updateTenantAnalyticsSettings } =
      await import("./tenant-analytics-settings");

    const result = await updateTenantAnalyticsSettings(
      updateInput(
        {
          consentMode: "external",
          ga4MeasurementId: "",
          gtmContainerId: "GTM-XYZ789",
          serverContainerUrl: "https://sgtm.example.com",
          servingMode: "gateway",
        },
        true
      ),
      "en"
    );

    expect(result).toEqual({
      ok: true,
      settings: {
        consentMode: "external",
        ga4MeasurementId: "",
        gatewayPath: "_qrstuvwxyz234567",
        gtmContainerId: "GTM-XYZ789",
        serverContainerUrl: "https://sgtm.example.com",
        servingMode: "gateway",
      },
    });
    expect(mockUpdateTenantAnalyticsSettingsApi).toHaveBeenCalledWith(
      {
        regenerateGatewayPath: true,
        settings: {
          consentMode: GoogleTagConsentMode.EXTERNAL,
          ga4MeasurementId: "",
          gtmContainerId: "GTM-XYZ789",
          serverContainerUrl: "https://sgtm.example.com",
          servingMode: GoogleTagServingMode.GATEWAY,
        },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it.each([
    [
      "settings.ga4_measurement_id",
      updateInput({ ga4MeasurementId: "G-ABC123" }),
      {
        ga4MeasurementId:
          "Enter the measurement ID as G- followed by letters and digits, such as G-ABC123DEF4.",
      },
    ],
    [
      "settings.ga4_measurement_id",
      updateInput({ ga4MeasurementId: "UA-1234-1" }),
      {
        ga4MeasurementId:
          "Google no longer collects data for a Universal Analytics ID (UA-). Enter a Google Analytics 4 measurement ID, starting G-.",
      },
    ],
    [
      "settings.gtm_container_id",
      updateInput({ gtmContainerId: "GTM-ABC" }),
      {
        gtmContainerId:
          "Enter the container ID as GTM- followed by letters and digits, such as GTM-ABC1234.",
      },
    ],
    [
      "settings.gtm_container_id",
      updateInput({ consentMode: "external" }),
      {
        gtmContainerId:
          "Enter a Tag Manager container ID for your consent tool to run in, or choose another option under Reader consent.",
      },
    ],
    [
      "settings.consent_mode",
      updateInput(),
      {
        consentMode: "Choose whether readers are asked before the tag runs.",
      },
    ],
    [
      "settings.serving_mode",
      updateInput(),
      { servingMode: "Choose where the tag is loaded from." },
    ],
    [
      "settings.server_container_url",
      updateInput({
        serverContainerUrl: "https://10.0.0.1",
        servingMode: "server_container",
      }),
      {
        serverContainerUrl:
          "Enter an https address on a domain name, with no path, such as https://sgtm.example.com.",
      },
    ],
    [
      "settings.server_container_url",
      updateInput({ servingMode: "server_container" }),
      {
        serverContainerUrl:
          "Enter the server container URL to load the tag from your server container.",
      },
    ],
  ])(
    "names the field the API refused (%s)",
    async (field, input, fieldErrors) => {
      mockUpdateTenantAnalyticsSettingsApi.mockRejectedValueOnce(
        fieldViolation(field)
      );

      const { updateTenantAnalyticsSettings } =
        await import("./tenant-analytics-settings");

      const result = await updateTenantAnalyticsSettings(input, "en");

      expect(result).toEqual({
        fieldErrors,
        message: "Please check the information you entered.",
        ok: false,
      });
    }
  );

  it("tells an operator who is not a tenant admin that the save was refused", async () => {
    mockUpdateTenantAnalyticsSettingsApi.mockRejectedValueOnce(
      new ConnectError("tenant admin required", Code.PermissionDenied)
    );

    const { updateTenantAnalyticsSettings } =
      await import("./tenant-analytics-settings");

    const result = await updateTenantAnalyticsSettings(updateInput(), "en");

    expect(result).toEqual({
      message:
        "You do not have permission to perform this action. Go back or use an account that does.",
      ok: false,
    });
  });
});
