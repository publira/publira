import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as PublicApiModule from "./public-api";

const {
  mockGetAccessToken,
  mockGetTenantPublicInfo,
  mockUpdateTenantDefaultLocaleApi,
} = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockGetTenantPublicInfo: vi.fn(),
  mockUpdateTenantDefaultLocaleApi: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./public-api", async (importOriginal) => ({
  ...(await importOriginal<typeof PublicApiModule>()),
  getTenantPublicInfo: mockGetTenantPublicInfo,
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

describe("tenant-locales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns the languages the public tenant read answered with", async () => {
    mockGetTenantPublicInfo.mockResolvedValueOnce({
      defaultLocale: "en",
      supportedLocales: ["ja", "en"],
    });

    const { getTenantLocales } = await import("./tenant-locales");

    const result = await getTenantLocales("TENANT001", "en");

    expect(result).toEqual({
      defaultLocale: "en",
      ok: true,
      supportedLocales: ["ja", "en"],
    });
    expect(mockGetTenantPublicInfo).toHaveBeenCalledWith("TENANT001");
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it("reports a failed read without naming saved languages", async () => {
    mockGetTenantPublicInfo.mockResolvedValueOnce(null);

    const { getTenantLocales } = await import("./tenant-locales");

    const result = await getTenantLocales("TENANT001", "en");

    expect(result).toEqual({
      message: "Could not load the languages. Please try again later.",
      ok: false,
    });
    expect(result).not.toHaveProperty("defaultLocale");
  });

  // Only a code this build serves no catalog for can leave the default out of
  // the set the API answers, and a form built on that pair could not save it.
  it("reports a set that leaves the default out as a failed read", async () => {
    mockGetTenantPublicInfo.mockResolvedValueOnce({
      defaultLocale: "en",
      supportedLocales: ["ja"],
    });

    const { findTenantLocales } = await import("./tenant-locales");

    await expect(findTenantLocales("TENANT001")).resolves.toBeNull();
  });

  it("saves the default and the set in one request", async () => {
    mockUpdateTenantDefaultLocaleApi.mockResolvedValueOnce({
      defaultLocale: "en",
      supportedLocales: ["ja", "en"],
    });

    const { updateTenantLocales } = await import("./tenant-locales");

    const result = await updateTenantLocales(
      {
        defaultLocale: "en",
        supportedLocales: ["en", "ja"],
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      defaultLocale: "en",
      ok: true,
      supportedLocales: ["ja", "en"],
    });
    expect(mockUpdateTenantDefaultLocaleApi).toHaveBeenCalledOnce();
    expect(mockUpdateTenantDefaultLocaleApi).toHaveBeenCalledWith(
      {
        defaultLocale: "en",
        supportedLocales: ["en", "ja"],
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("returns the shared input error message for invalid_argument on an update", async () => {
    mockUpdateTenantDefaultLocaleApi.mockRejectedValueOnce(
      new ConnectError(
        "supported_locales must include default_locale",
        Code.InvalidArgument
      )
    );

    const { updateTenantLocales } = await import("./tenant-locales");

    const result = await updateTenantLocales(
      {
        defaultLocale: "en",
        supportedLocales: ["ja"],
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

    const { updateTenantLocales } = await import("./tenant-locales");

    const result = await updateTenantLocales(
      {
        defaultLocale: "en",
        supportedLocales: ["en"],
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(false);
  });
});
