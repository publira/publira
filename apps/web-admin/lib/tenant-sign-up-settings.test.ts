import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantSignUpSettingsApi,
  mockUpdateTenantSignUpSettingsApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantSignUpSettingsApi: vi.fn(),
  mockUpdateTenantSignUpSettingsApi: vi.fn(),
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
      getTenantSignUpSettings: mockGetTenantSignUpSettingsApi,
      updateTenantSignUpSettings: mockUpdateTenantSignUpSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const failedReadCacheLife = { expire: 0, revalidate: 0, stale: 0 };

describe("tenant-sign-up-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns the saved settings of the tenant on a successful fetch", async () => {
    mockGetTenantSignUpSettingsApi.mockResolvedValueOnce({
      settings: { closedMessage: "Back in spring.", signUpOpen: false },
    });

    const { getTenantSignUpSettings } =
      await import("./tenant-sign-up-settings");

    await expect(getTenantSignUpSettings("TENANT001", "en")).resolves.toEqual({
      ok: true,
      settings: { closedMessage: "Back in spring.", signUpOpen: false },
    });
    expect(mockGetTenantSignUpSettingsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:sign-up-settings"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("reports a missing session and drops the cache entry", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantSignUpSettings } =
      await import("./tenant-sign-up-settings");

    await expect(getTenantSignUpSettings("TENANT001", "en")).resolves.toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantSignUpSettingsApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith(failedReadCacheLife);
  });

  it("treats a response without settings as a failed read rather than as open", async () => {
    mockGetTenantSignUpSettingsApi.mockResolvedValueOnce({});

    const { getTenantSignUpSettings } =
      await import("./tenant-sign-up-settings");

    await expect(getTenantSignUpSettings("TENANT001", "en")).resolves.toEqual({
      message: "Could not load the sign-up settings. Please try again later.",
      ok: false,
      requiresSignIn: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith(failedReadCacheLife);
  });

  it("reports a failed read without naming saved settings and drops the cache entry", async () => {
    mockGetTenantSignUpSettingsApi.mockRejectedValueOnce(
      new ConnectError("tenant unavailable", Code.Unavailable)
    );

    const { getTenantSignUpSettings } =
      await import("./tenant-sign-up-settings");

    const result = await getTenantSignUpSettings("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("settings");
    expect(mockCacheLife).toHaveBeenCalledWith(failedReadCacheLife);
  });

  it("writes both fields and answers what the server stored", async () => {
    mockUpdateTenantSignUpSettingsApi.mockResolvedValueOnce({
      settings: { closedMessage: "Back in spring.", signUpOpen: false },
    });

    const { updateTenantSignUpSettings } =
      await import("./tenant-sign-up-settings");

    await expect(
      updateTenantSignUpSettings(
        {
          closedMessage: "Back in spring.",
          signUpOpen: false,
          tenantId: " TENANT001 ",
        },
        "en"
      )
    ).resolves.toEqual({
      ok: true,
      settings: { closedMessage: "Back in spring.", signUpOpen: false },
    });
    expect(mockUpdateTenantSignUpSettingsApi).toHaveBeenCalledWith(
      {
        settings: { closedMessage: "Back in spring.", signUpOpen: false },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("words a save the server refused", async () => {
    mockUpdateTenantSignUpSettingsApi.mockRejectedValueOnce(
      new ConnectError("denied", Code.PermissionDenied)
    );

    const { updateTenantSignUpSettings } =
      await import("./tenant-sign-up-settings");

    const result = await updateTenantSignUpSettings(
      { closedMessage: "", signUpOpen: true, tenantId: "TENANT001" },
      "en"
    );

    expect(result.ok).toBe(false);
  });
});
