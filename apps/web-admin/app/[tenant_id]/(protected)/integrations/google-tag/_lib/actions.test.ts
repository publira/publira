import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockUpdateTag,
  mockUpdateTenantAnalyticsSettings,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateTenantAnalyticsSettings: vi.fn(),
}));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/auth-session", () => ({
  withAdminSessionReauth: (run: () => Promise<unknown>) => run(),
}));

vi.mock("#lib/tenant-analytics-settings", () => ({
  tenantAnalyticsSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:analytics-settings`,
  updateTenantAnalyticsSettings: mockUpdateTenantAnalyticsSettings,
}));

const googleTagFormData = (values: Record<string, string>): FormData => {
  const formData = new FormData();

  for (const [name, value] of Object.entries({
    consent_mode: "not_required",
    serving_mode: "google",
    tenant_id: "TENANT001",
    ...values,
  })) {
    formData.set(name, value);
  }

  return formData;
};

const VALIDATION = "Please check the information you entered.";

const MEASUREMENT_ID_INVALID =
  "Enter the measurement ID as G- followed by letters and digits, such as G-ABC123DEF4.";

const URL_INVALID =
  "Enter an https address on a domain name, with no path, such as https://sgtm.example.com.";

// Evaluating the Actions' module graph for the first time takes far longer than
// any test's own work, so it is paid here rather than inside one test's timeout.
beforeAll(async () => {
  await import("./actions");
});

describe("updateGoogleTagAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockUpdateTenantAnalyticsSettings.mockResolvedValue({
      ok: true,
      settings: {},
    });
  });

  it("saves the IDs trimmed and capitalized, then clears the cache tag", async () => {
    const { updateGoogleTagAction } = await import("./actions");

    const result = await updateGoogleTagAction(
      null,
      googleTagFormData({
        ga4_measurement_id: " g-abc123def4 ",
        gtm_container_id: "gtm-xyz789",
        server_container_url: " https://sgtm.example.com ",
        serving_mode: "server_container",
      })
    );

    expect(result).toEqual({
      message: "The Google tag settings were saved.",
      ok: true,
    });
    expect(mockAssertSameOrigin).toHaveBeenCalledOnce();
    expect(mockUpdateTenantAnalyticsSettings).toHaveBeenCalledWith(
      {
        regenerateGatewayPath: false,
        settings: {
          consentMode: "not_required",
          ga4MeasurementId: "G-ABC123DEF4",
          gtmContainerId: "GTM-XYZ789",
          serverContainerUrl: "https://sgtm.example.com",
          servingMode: "server_container",
        },
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:analytics-settings"
    );
  });

  it("saves Google's own servers with no server container URL, which clears it", async () => {
    const { updateGoogleTagAction } = await import("./actions");
    await updateGoogleTagAction(
      null,
      googleTagFormData({ ga4_measurement_id: "", gtm_container_id: "" })
    );

    expect(mockUpdateTenantAnalyticsSettings).toHaveBeenCalledWith(
      {
        regenerateGatewayPath: false,
        settings: {
          consentMode: "not_required",
          ga4MeasurementId: "",
          gtmContainerId: "",
          serverContainerUrl: "",
          servingMode: "google",
        },
        tenantId: "TENANT001",
      },
      "en"
    );
  });

  it("saves the consent mode chosen", async () => {
    const { updateGoogleTagAction } = await import("./actions");
    await updateGoogleTagAction(
      null,
      googleTagFormData({
        consent_mode: "external",
        gtm_container_id: "GTM-XYZ789",
      })
    );

    expect(mockUpdateTenantAnalyticsSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          consentMode: "external",
          gtmContainerId: "GTM-XYZ789",
        }),
      }),
      "en"
    );
  });

  it("asks for a new gateway path and says one was generated", async () => {
    const { updateGoogleTagAction } = await import("./actions");

    const result = await updateGoogleTagAction(
      null,
      googleTagFormData({
        gtm_container_id: "GTM-XYZ789",
        regenerate_gateway_path: "on",
        serving_mode: "gateway",
      })
    );

    expect(result).toEqual({
      message:
        "A new gateway path was generated, and the Google tag settings were saved.",
      ok: true,
    });
    expect(mockUpdateTenantAnalyticsSettings).toHaveBeenCalledWith(
      expect.objectContaining({ regenerateGatewayPath: true }),
      "en"
    );
  });

  it.each([
    [
      { ga4_measurement_id: "G-" },
      { ga4MeasurementId: MEASUREMENT_ID_INVALID },
    ],
    [
      { ga4_measurement_id: "ABC123" },
      { ga4MeasurementId: MEASUREMENT_ID_INVALID },
    ],
    [
      { ga4_measurement_id: "ua-1234-1" },
      {
        ga4MeasurementId:
          "Google no longer collects data for a Universal Analytics ID (UA-). Enter a Google Analytics 4 measurement ID, starting G-.",
      },
    ],
    [
      { gtm_container_id: "GTM-ABC_1" },
      {
        gtmContainerId:
          "Enter the container ID as GTM- followed by letters and digits, such as GTM-ABC1234.",
      },
    ],
    [
      { serving_mode: "server_container" },
      {
        serverContainerUrl:
          "Enter the server container URL to load the tag from your server container.",
      },
    ],
    [
      {
        server_container_url: "http://sgtm.example.com",
        serving_mode: "gateway",
      },
      { serverContainerUrl: URL_INVALID },
    ],
    [
      { consent_mode: "external", gtm_container_id: " " },
      {
        gtmContainerId:
          "Enter a Tag Manager container ID for your consent tool to run in, or choose another option under Reader consent.",
      },
    ],
    [
      { consent_mode: "always" },
      {
        consentMode: "Choose whether readers are asked before the tag runs.",
      },
    ],
    [
      { serving_mode: "proxy" },
      { servingMode: "Choose where the tag is loaded from." },
    ],
  ])(
    "refuses %o next to its field without saving",
    async (values, fieldErrors) => {
      const { updateGoogleTagAction } = await import("./actions");

      const result = await updateGoogleTagAction(
        null,
        googleTagFormData(values)
      );

      expect(result).toEqual({ fieldErrors, message: VALIDATION, ok: false });
      expect(mockUpdateTenantAnalyticsSettings).not.toHaveBeenCalled();
      expect(mockUpdateTag).not.toHaveBeenCalled();
    }
  );

  it("passes on what the API refused, field by field", async () => {
    mockUpdateTenantAnalyticsSettings.mockResolvedValueOnce({
      fieldErrors: { serverContainerUrl: URL_INVALID },
      message: VALIDATION,
      ok: false,
    });

    const { updateGoogleTagAction } = await import("./actions");

    const result = await updateGoogleTagAction(
      null,
      googleTagFormData({
        server_container_url: "https://sgtm.example.com",
        serving_mode: "server_container",
      })
    );

    expect(result).toEqual({
      fieldErrors: { serverContainerUrl: URL_INVALID },
      message: VALIDATION,
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
