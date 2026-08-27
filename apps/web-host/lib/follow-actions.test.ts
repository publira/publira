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

  it("フォロー成功後に会員のフォローキャッシュだけを更新する", async () => {
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
    // 再ログインへ送るときにリーダーの locale を保つ。
    expect(mockRequirePublicSession).toHaveBeenCalledWith(
      "en",
      "/series/SERIES01"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(`tenant:${tenantId}:follows`);
  });

  it("解除成功後に会員のフォローキャッシュだけを更新する", async () => {
    mockUnfollowTarget.mockResolvedValueOnce({ isFollowing: false, ok: true });

    const { toggleFollowAction } = await import("./follow-actions");
    const result = await toggleFollowAction(
      null,
      formData({
        intent: "unfollow",
        publicId: "AUTHOR01",
        returnTo: "/authors/AUTHOR01",
        targetKind: "author",
        tenantId,
      })
    );

    expect(result).toEqual({
      isFollowing: false,
      message: "フォローを解除しました。",
      ok: true,
    });
    expect(mockUnfollowTarget).toHaveBeenCalledWith({
      locale: "ja",
      publicId: "AUTHOR01",
      targetKind: "author",
      tenantId,
    });
    expect(mockUpdateTag).toHaveBeenCalledWith(`tenant:${tenantId}:follows`);
  });

  it("一覧からの解除も同じ Action で会員のフォローキャッシュだけを更新する", async () => {
    mockUnfollowTarget.mockResolvedValueOnce({ isFollowing: false, ok: true });

    const { toggleFollowAction } = await import("./follow-actions");
    const result = await toggleFollowAction(
      null,
      formData({
        intent: "unfollow",
        publicId: "SERIES01",
        returnTo: "/settings/follows",
        targetKind: "series",
        tenantId,
      })
    );

    expect(result).toEqual({
      isFollowing: false,
      message: "フォローを解除しました。",
      ok: true,
    });
    expect(mockRequirePublicSession).toHaveBeenCalledWith(
      "ja",
      "/settings/follows"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(`tenant:${tenantId}:follows`);
    expect(mockUpdateTag).toHaveBeenCalledTimes(1);
  });

  it("不正な対象種別は API を呼ばない", async () => {
    const { toggleFollowAction } = await import("./follow-actions");
    const result = await toggleFollowAction(
      null,
      formData({
        intent: "follow",
        publicId: "SERIES01",
        returnTo: "/series/SERIES01",
        targetKind: "episode",
        tenantId,
      })
    );

    expect(result).toEqual({
      message: "入力内容を確認してください。",
      ok: false,
    });
    expect(mockFollowTarget).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("API が拒否したらメッセージを返し、タグは更新しない", async () => {
    mockFollowTarget.mockResolvedValueOnce({
      message: "対象が見つかりません。",
      ok: false,
    });

    const { toggleFollowAction } = await import("./follow-actions");
    const result = await toggleFollowAction(
      null,
      formData({
        intent: "follow",
        publicId: "MISSING01",
        returnTo: "/series/MISSING01",
        targetKind: "series",
        tenantId,
      })
    );

    expect(result).toEqual({
      message: "対象が見つかりません。",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
