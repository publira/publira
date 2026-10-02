import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAccessToken,
  mockGetTenantPublicInfo,
  mockUpdateTenantTimezoneApi,
} = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockGetTenantPublicInfo: vi.fn(),
  mockUpdateTenantTimezoneApi: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./public-api", () => ({
  getTenantPublicInfo: mockGetTenantPublicInfo,
}));

vi.mock("./api", () => ({
  apiClient: {
    tenantSettings: {
      updateTenantTimezone: mockUpdateTenantTimezoneApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("tenant-timezone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns the time zone the public tenant read answered with", async () => {
    mockGetTenantPublicInfo.mockResolvedValueOnce({
      timezone: "America/Los_Angeles",
    });

    const { getTenantTimezone } = await import("./tenant-timezone");

    const result = await getTenantTimezone("TENANT001", "en");

    expect(result).toEqual({ ok: true, timezone: "America/Los_Angeles" });
    expect(mockGetTenantPublicInfo).toHaveBeenCalledWith("TENANT001");
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it("returns the default alongside the failure so the form stays usable", async () => {
    mockGetTenantPublicInfo.mockResolvedValueOnce(null);

    const { getTenantTimezone } = await import("./tenant-timezone");

    const result = await getTenantTimezone("TENANT001", "en");

    expect(result).toEqual({
      message: "Could not load the time zone. Please try again later.",
      ok: false,
      timezone: "UTC",
    });
  });

  it("reports a response without a time zone as a failed read", async () => {
    mockGetTenantPublicInfo.mockResolvedValueOnce({ timezone: null });

    const { getTenantTimezone } = await import("./tenant-timezone");

    const result = await getTenantTimezone("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result.timezone).toBe("UTC");
  });

  it("returns the saved time zone on a successful update", async () => {
    mockUpdateTenantTimezoneApi.mockResolvedValueOnce({
      timezone: "Europe/Paris",
    });

    const { updateTenantTimezone } = await import("./tenant-timezone");

    const result = await updateTenantTimezone(
      {
        tenantId: "TENANT001",
        timezone: "Europe/Paris",
      },
      "en"
    );

    expect(result).toEqual({ ok: true, timezone: "Europe/Paris" });
    expect(mockUpdateTenantTimezoneApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" }, timezone: "Europe/Paris" },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("returns the message of the server as it is for invalid_argument on an update", async () => {
    mockUpdateTenantTimezoneApi.mockRejectedValueOnce(
      new ConnectError(
        "timezone must be a valid IANA time zone name",
        Code.InvalidArgument
      )
    );

    const { updateTenantTimezone } = await import("./tenant-timezone");

    const result = await updateTenantTimezone(
      {
        tenantId: "TENANT001",
        timezone: "Asia/Nowhere",
      },
      "en"
    );

    expect(result).toEqual({
      message: "timezone must be a valid IANA time zone name",
      ok: false,
    });
  });

  it("returns the shared permission error message without the permission", async () => {
    mockUpdateTenantTimezoneApi.mockRejectedValueOnce(
      new ConnectError("admin role required", Code.PermissionDenied)
    );

    const { updateTenantTimezone } = await import("./tenant-timezone");

    const result = await updateTenantTimezone(
      {
        tenantId: "TENANT001",
        timezone: "Europe/Paris",
      },
      "en"
    );

    expect(result.ok).toBe(false);
  });

  it("returns the time zone of the tenant as the display time zone", async () => {
    mockGetTenantPublicInfo.mockResolvedValueOnce({
      timezone: "America/Los_Angeles",
    });

    const { getTenantDisplayTimeZone } = await import("./tenant-timezone");

    await expect(getTenantDisplayTimeZone("TENANT001")).resolves.toBe(
      "America/Los_Angeles"
    );
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  it("still renders in the default time zone when the tenant cannot be read", async () => {
    // Degrading to the host's zone would make the rendered wall clock depend on
    // where the container runs, which is exactly what the tenant zone removes.
    mockGetTenantPublicInfo.mockResolvedValueOnce(null);

    const { getTenantDisplayTimeZone } = await import("./tenant-timezone");

    await expect(getTenantDisplayTimeZone("TENANT001")).resolves.toBe("UTC");
  });
});
