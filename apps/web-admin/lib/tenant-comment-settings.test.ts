import { CommentMode } from "@publira/api-client/admin/types";
import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantCommentSettingsApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantCommentSettingsApi: vi.fn(),
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
      getTenantCommentSettings: mockGetTenantCommentSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("tenant-comment-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns the saved settings of the tenant on a successful fetch", async () => {
    mockGetTenantCommentSettingsApi.mockResolvedValueOnce({
      autoHideReportThreshold: 3,
      commentMode: CommentMode.APPROVAL_REQUIRED,
    });

    const { getTenantCommentSettings } =
      await import("./tenant-comment-settings");

    const result = await getTenantCommentSettings("TENANT001", "en");

    expect(result).toEqual({
      autoHideReportThreshold: 3,
      commentMode: "approval_required",
      ok: true,
    });
    expect(mockGetTenantCommentSettingsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:comment-settings"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("reports a missing session and drops the cache entry", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantCommentSettings } =
      await import("./tenant-comment-settings");

    const result = await getTenantCommentSettings("TENANT001", "en");

    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantCommentSettingsApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("treats an unspecified mode as a failed read and drops the cache entry", async () => {
    mockGetTenantCommentSettingsApi.mockResolvedValueOnce({
      autoHideReportThreshold: 0,
      commentMode: CommentMode.UNSPECIFIED,
    });

    const { getTenantCommentSettings } =
      await import("./tenant-comment-settings");

    const result = await getTenantCommentSettings("TENANT001", "en");

    expect(result).toEqual({
      message: "Could not load the comment settings. Please try again later.",
      ok: false,
      requiresSignIn: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a failed read without naming saved settings and drops the cache entry", async () => {
    mockGetTenantCommentSettingsApi.mockRejectedValueOnce(
      new ConnectError("tenant unavailable", Code.Unavailable)
    );

    const { getTenantCommentSettings } =
      await import("./tenant-comment-settings");

    const result = await getTenantCommentSettings("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("commentMode");
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});
