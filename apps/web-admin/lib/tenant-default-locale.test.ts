import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindTenantDisplayLocale,
  mockGetAccessToken,
  mockUpdateTenantDefaultLocaleApi,
} = vi.hoisted(() => ({
  mockFindTenantDisplayLocale: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockUpdateTenantDefaultLocaleApi: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./public-api", () => ({
  findTenantDisplayLocale: mockFindTenantDisplayLocale,
}));

vi.mock("./api", () => ({
  apiClient: {
    tenantSettings: {
      updateTenantDefaultLocale: mockUpdateTenantDefaultLocaleApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("tenant-default-locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns the default locale the public tenant read answered with", async () => {
    mockFindTenantDisplayLocale.mockResolvedValueOnce("en");

    const { getTenantDefaultLocale } = await import("./tenant-default-locale");

    const result = await getTenantDefaultLocale("TENANT001", "en");

    expect(result).toEqual({ defaultLocale: "en", ok: true });
    expect(mockFindTenantDisplayLocale).toHaveBeenCalledWith("TENANT001");
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it("reports a failed read without naming a saved locale", async () => {
    mockFindTenantDisplayLocale.mockResolvedValueOnce(null);

    const { getTenantDefaultLocale } = await import("./tenant-default-locale");

    const result = await getTenantDefaultLocale("TENANT001", "en");

    expect(result).toEqual({
      message: "Could not load the default language. Please try again later.",
      ok: false,
    });
    expect(result).not.toHaveProperty("defaultLocale");
  });

  it("returns the saved default locale on a successful update", async () => {
    mockUpdateTenantDefaultLocaleApi.mockResolvedValueOnce({
      defaultLocale: "en",
    });

    const { updateTenantDefaultLocale } =
      await import("./tenant-default-locale");

    const result = await updateTenantDefaultLocale(
      {
        defaultLocale: "en",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({ defaultLocale: "en", ok: true });
    expect(mockUpdateTenantDefaultLocaleApi).toHaveBeenCalledWith(
      { defaultLocale: "en", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("returns the shared input error message for invalid_argument on an update", async () => {
    mockUpdateTenantDefaultLocaleApi.mockRejectedValueOnce(
      new ConnectError(
        "default_locale must be a supported locale",
        Code.InvalidArgument
      )
    );

    const { updateTenantDefaultLocale } =
      await import("./tenant-default-locale");

    const result = await updateTenantDefaultLocale(
      {
        defaultLocale: "en",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message: "The submitted values are invalid. Check them and try again.",
      ok: false,
    });
  });

  it("returns the shared permission error message without the permission", async () => {
    mockUpdateTenantDefaultLocaleApi.mockRejectedValueOnce(
      new ConnectError("admin role required", Code.PermissionDenied)
    );

    const { updateTenantDefaultLocale } =
      await import("./tenant-default-locale");

    const result = await updateTenantDefaultLocale(
      {
        defaultLocale: "en",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(false);
  });
});
