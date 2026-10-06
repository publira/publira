import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantEmailRejectionSettingsApi,
  mockUpdateTenantEmailRejectionSettingsApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantEmailRejectionSettingsApi: vi.fn(),
  mockUpdateTenantEmailRejectionSettingsApi: vi.fn(),
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
      getTenantEmailRejectionSettings: mockGetTenantEmailRejectionSettingsApi,
      updateTenantEmailRejectionSettings:
        mockUpdateTenantEmailRejectionSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const STORED = {
  disposableDomainListAvailable: true,
  settings: {
    entries: ["refused.example", "someone@example.com"],
    rejectDisposableDomains: true,
  },
};

describe("tenant-email-rejection-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads the setting under the tenant's tag", async () => {
    mockGetTenantEmailRejectionSettingsApi.mockResolvedValueOnce(STORED);

    const { getTenantEmailRejectionSettings } =
      await import("./tenant-email-rejection-settings");
    const result = await getTenantEmailRejectionSettings(" TENANT001 ", "en");

    expect(result).toEqual({ ok: true, ...STORED });
    expect(mockGetTenantEmailRejectionSettingsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:email-rejection-settings"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("answers a tenant that has saved nothing as refusing nothing", async () => {
    mockGetTenantEmailRejectionSettingsApi.mockResolvedValueOnce({
      disposableDomainListAvailable: false,
    });

    const { getTenantEmailRejectionSettings } =
      await import("./tenant-email-rejection-settings");

    await expect(
      getTenantEmailRejectionSettings("TENANT001", "en")
    ).resolves.toEqual({
      disposableDomainListAvailable: false,
      ok: true,
      settings: { entries: [], rejectDisposableDomains: false },
    });
  });

  it("reports a missing session and drops the cache entry", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantEmailRejectionSettings } =
      await import("./tenant-email-rejection-settings");

    await expect(
      getTenantEmailRejectionSettings("TENANT001", "en")
    ).resolves.toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantEmailRejectionSettingsApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a failed read without naming a setting and drops the cache entry", async () => {
    mockGetTenantEmailRejectionSettingsApi.mockRejectedValueOnce(
      new ConnectError("tenant unavailable", Code.Unavailable)
    );

    const { getTenantEmailRejectionSettings } =
      await import("./tenant-email-rejection-settings");
    const result = await getTenantEmailRejectionSettings("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("settings");
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("saves the whole setting and answers it as the server stored it", async () => {
    mockUpdateTenantEmailRejectionSettingsApi.mockResolvedValueOnce({
      disposableDomainListAvailable: true,
      settings: { entries: ["refused.example"], rejectDisposableDomains: true },
    });

    const { updateTenantEmailRejectionSettings } =
      await import("./tenant-email-rejection-settings");
    const result = await updateTenantEmailRejectionSettings(
      {
        entries: ["Refused.Example", "refused.example"],
        rejectDisposableDomains: true,
        tenantId: " TENANT001 ",
      },
      "en"
    );

    expect(result).toEqual({
      disposableDomainListAvailable: true,
      ok: true,
      settings: { entries: ["refused.example"], rejectDisposableDomains: true },
    });
    expect(mockUpdateTenantEmailRejectionSettingsApi).toHaveBeenCalledWith(
      {
        settings: {
          entries: ["Refused.Example", "refused.example"],
          rejectDisposableDomains: true,
        },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("words the server's refusal of the list for the field", async () => {
    mockUpdateTenantEmailRejectionSettingsApi.mockRejectedValueOnce(
      new ConnectError("rejected", Code.InvalidArgument, undefined, [
        {
          desc: BadRequestSchema,
          value: { fieldViolations: [{ field: "settings.entries" }] },
        },
      ])
    );

    const { updateTenantEmailRejectionSettings } =
      await import("./tenant-email-rejection-settings");
    const result = await updateTenantEmailRejectionSettings(
      {
        entries: ["xn--zz.com"],
        rejectDisposableDomains: false,
        tenantId: "T",
      },
      "en"
    );

    const message =
      "Check the list. Each entry must be one email address or domain, and at most 1,000 can be listed.";
    expect(result).toEqual({ entriesError: message, message, ok: false });
  });

  it("leaves an ended session to the caller's sign-in redirect", async () => {
    mockUpdateTenantEmailRejectionSettingsApi.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    const { updateTenantEmailRejectionSettings } =
      await import("./tenant-email-rejection-settings");

    await expect(
      updateTenantEmailRejectionSettings(
        { entries: [], rejectDisposableDomains: false, tenantId: "T" },
        "en"
      )
    ).rejects.toBeInstanceOf(ConnectError);
  });
});
