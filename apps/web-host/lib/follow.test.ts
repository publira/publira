import { Code, ConnectError } from "@publira/api-client/errors";
import { FollowTargetType } from "@publira/api-client/public/catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  followTarget,
  getMyFollowStatus,
  toFollowTargetKind,
  toFollowTargetType,
  unfollowTarget,
} from "./follow";

const {
  mockFollow,
  mockGetMyFollowStatus,
  mockResolveAccessToken,
  mockUnfollow,
} = vi.hoisted(() => ({
  mockFollow: vi.fn(),
  mockGetMyFollowStatus: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockUnfollow: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    follow: {
      follow: mockFollow,
      getMyFollowStatus: mockGetMyFollowStatus,
      unfollow: mockUnfollow,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("toFollowTargetType", () => {
  it("maps author and series kinds onto the Follow API enum", () => {
    expect(toFollowTargetType("author")).toBe(FollowTargetType.AUTHOR);
    expect(toFollowTargetType("series")).toBe(FollowTargetType.SERIES);
  });
});

describe("toFollowTargetKind", () => {
  it("maps author and series enums back onto the app kinds", () => {
    expect(toFollowTargetKind(FollowTargetType.AUTHOR)).toBe("author");
    expect(toFollowTargetKind(FollowTargetType.SERIES)).toBe("series");
  });

  it("drops episode and unspecified — this app has no public page for those", () => {
    expect(toFollowTargetKind(FollowTargetType.EPISODE)).toBeNull();
    expect(toFollowTargetKind(FollowTargetType.UNSPECIFIED)).toBeNull();
  });
});

describe("getMyFollowStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("ゲストは RPC を呼ばず未ログインとして返す", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");

    const result = await getMyFollowStatus(tenantId, "series", "SERIES01");

    expect(result).toEqual({
      isFollowing: false,
      ok: true,
      signedIn: false,
    });
    expect(mockGetMyFollowStatus).not.toHaveBeenCalled();
  });

  it("会員のフォロー状態を返す", async () => {
    mockGetMyFollowStatus.mockResolvedValueOnce({ isFollowing: true });

    const result = await getMyFollowStatus(tenantId, "author", "AUTHOR01");

    expect(mockGetMyFollowStatus).toHaveBeenCalledWith(
      {
        target: { publicId: "AUTHOR01", type: FollowTargetType.AUTHOR },
        tenant: { tenantId },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      isFollowing: true,
      ok: true,
      signedIn: true,
    });
  });

  it("失効セッションは未ログインとして扱い、存在は漏らさない", async () => {
    mockGetMyFollowStatus.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    const result = await getMyFollowStatus(tenantId, "series", "SERIES01");

    expect(result).toEqual({
      isFollowing: false,
      ok: true,
      signedIn: false,
    });
  });

  it("非公開・不存在は共通の not-found 文言にする", async () => {
    mockGetMyFollowStatus.mockRejectedValueOnce(
      new ConnectError("missing", Code.NotFound)
    );

    const result = await getMyFollowStatus(tenantId, "series", "MISSING01");

    expect(result).toEqual({
      message: "対象が見つかりません。",
      ok: false,
    });
  });
});

describe("followTarget / unfollowTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("フォロー成功を返す", async () => {
    mockFollow.mockResolvedValueOnce({ isFollowing: true });

    await expect(
      followTarget({
        publicId: "SERIES01",
        targetKind: "series",
        tenantId,
      })
    ).resolves.toEqual({ isFollowing: true, ok: true });
    expect(mockFollow).toHaveBeenCalledWith(
      {
        target: { publicId: "SERIES01", type: FollowTargetType.SERIES },
        tenant: { tenantId },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("解除成功を返す", async () => {
    mockUnfollow.mockResolvedValueOnce({ isFollowing: false });

    await expect(
      unfollowTarget({
        publicId: "AUTHOR01",
        targetKind: "author",
        tenantId,
      })
    ).resolves.toEqual({ isFollowing: false, ok: true });
  });

  it("Unauthenticated は再認証のために再 throw する", async () => {
    mockFollow.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    await expect(
      followTarget({
        publicId: "SERIES01",
        targetKind: "series",
        tenantId,
      })
    ).rejects.toBeInstanceOf(ConnectError);
  });
});
