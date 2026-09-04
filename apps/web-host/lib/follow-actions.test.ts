import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockFollowTarget,
  mockRequirePublicSession,
  mockUnfollowTarget,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockFollowTarget: vi.fn(),
  mockRequirePublicSession: vi.fn(),
  mockUnfollowTarget: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("./follow", () => ({
  followTarget: mockFollowTarget,
  followTargetKinds: ["author", "series"],
  followsCacheTag: (tenantId: string) => `tenant:${tenantId}:follows`,
  unfollowTarget: mockUnfollowTarget,
}));

vi.mock("./auth-session", () => ({
  requirePublicSession: mockRequirePublicSession,
  withPublicSessionReauth: (
    _locale: string,
    _returnTo: string,
    run: () => Promise<unknown>
  ) => run(),
}));

vi.mock("./csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

const formData = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("toggleFollowAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockRequirePublicSession.mockResolvedValue("session-token");
  });

  it("Update only the member's follow cache after a successful follow", async () => {
    mockFollowTarget.mockResolvedValueOnce({ isFollowing: true, ok: true });

    const { toggleFollowAction } = await import("./follow-actions");
    const result = await toggleFollowAction(
      null,
      formData({
        intent: "follow",
        locale: "en",
        publicId: "SERIES01",
        returnTo: "/series/SERIES01",
        targetKind: "series",
        tenantId,
      })
    );

    expect(result).toEqual({
      isFollowing: true,
      message: "You are now following this.",
      ok: true,
    });
    expect(mockFollowTarget).toHaveBeenCalledWith({
      locale: "en",
      publicId: "SERIES01",
      targetKind: "series",
      tenantId,
    });
    // The reader's locale is kept when they are sent to sign in again.
    expect(mockRequirePublicSession).toHaveBeenCalledWith(
      "en",
      "/series/SERIES01",
      tenantId
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(`tenant:${tenantId}:follows`);
  });

  it("Update only the member's follow cache after successful cancellation", async () => {
    mockUnfollowTarget.mockResolvedValueOnce({ isFollowing: false, ok: true });

    const { toggleFollowAction } = await import("./follow-actions");
    const result = await toggleFollowAction(
      null,
      formData({
        intent: "unfollow",
        locale: "en",
        publicId: "AUTHOR01",
        returnTo: "/authors/AUTHOR01",
        targetKind: "author",
        tenantId,
      })
    );

    expect(result).toEqual({
      isFollowing: false,
      message: "You are no longer following this.",
      ok: true,
    });
    expect(mockUnfollowTarget).toHaveBeenCalledWith({
      locale: "en",
      publicId: "AUTHOR01",
      targetKind: "author",
      tenantId,
    });
    expect(mockUpdateTag).toHaveBeenCalledWith(`tenant:${tenantId}:follows`);
  });

  it("Update only the member's follow cache using the same Action to remove from the list.", async () => {
    mockUnfollowTarget.mockResolvedValueOnce({ isFollowing: false, ok: true });

    const { toggleFollowAction } = await import("./follow-actions");
    const result = await toggleFollowAction(
      null,
      formData({
        intent: "unfollow",
        locale: "en",
        publicId: "SERIES01",
        returnTo: "/settings/follows",
        targetKind: "series",
        tenantId,
      })
    );

    expect(result).toEqual({
      isFollowing: false,
      message: "You are no longer following this.",
      ok: true,
    });
    expect(mockRequirePublicSession).toHaveBeenCalledWith(
      "en",
      "/settings/follows",
      tenantId
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(`tenant:${tenantId}:follows`);
    expect(mockUpdateTag).toHaveBeenCalledTimes(1);
  });

  it("Invalid target type does not call API", async () => {
    const { toggleFollowAction } = await import("./follow-actions");
    const result = await toggleFollowAction(
      null,
      formData({
        intent: "follow",
        locale: "en",
        publicId: "SERIES01",
        returnTo: "/series/SERIES01",
        targetKind: "episode",
        tenantId,
      })
    );

    expect(result).toEqual({
      message: "Please check the information you entered.",
      ok: false,
    });
    expect(mockFollowTarget).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("If the API rejects, return a message and do not update the tag.", async () => {
    mockFollowTarget.mockResolvedValueOnce({
      message: "The requested item could not be found.",
      ok: false,
    });

    const { toggleFollowAction } = await import("./follow-actions");
    const result = await toggleFollowAction(
      null,
      formData({
        intent: "follow",
        locale: "en",
        publicId: "MISSING01",
        returnTo: "/series/MISSING01",
        targetKind: "series",
        tenantId,
      })
    );

    expect(result).toEqual({
      message: "The requested item could not be found.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
