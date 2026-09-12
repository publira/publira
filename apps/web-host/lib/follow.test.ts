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
  it("maps creator and series kinds onto the Follow API enum", () => {
    expect(toFollowTargetType("creator")).toBe(FollowTargetType.CREATOR);
    expect(toFollowTargetType("series")).toBe(FollowTargetType.SERIES);
  });
});

describe("toFollowTargetKind", () => {
  it("maps creator and series enums back onto the app kinds", () => {
    expect(toFollowTargetKind(FollowTargetType.CREATOR)).toBe("creator");
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

  it("Guest does not call RPC and returns as not logged in", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");

    const result = await getMyFollowStatus(
      tenantId,
      "series",
      "SERIES01",
      "en"
    );

    expect(result).toEqual({
      isFollowing: false,
      ok: true,
      signedIn: false,
    });
    expect(mockGetMyFollowStatus).not.toHaveBeenCalled();
  });

  it("Returns member's follow status", async () => {
    mockGetMyFollowStatus.mockResolvedValueOnce({ isFollowing: true });

    const result = await getMyFollowStatus(
      tenantId,
      "creator",
      "CREATOR01",
      "en"
    );

    expect(mockGetMyFollowStatus).toHaveBeenCalledWith(
      {
        target: { publicId: "CREATOR01", type: FollowTargetType.CREATOR },
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

  it("Treat expired sessions as non-logged-in sessions and do not reveal their existence", async () => {
    mockGetMyFollowStatus.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    const result = await getMyFollowStatus(
      tenantId,
      "series",
      "SERIES01",
      "en"
    );

    expect(result).toEqual({
      isFollowing: false,
      ok: true,
      signedIn: false,
    });
  });

  it("Use a common not-found wording for non-disclosure/non-existence", async () => {
    mockGetMyFollowStatus.mockRejectedValueOnce(
      new ConnectError("missing", Code.NotFound)
    );

    const result = await getMyFollowStatus(
      tenantId,
      "series",
      "MISSING01",
      "en"
    );

    expect(result).toEqual({
      message:
        "The requested item could not be found. Go back and open it from the list.",
      ok: false,
    });
  });
});

describe("followTarget / unfollowTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("Return follow success", async () => {
    mockFollow.mockResolvedValueOnce({ isFollowing: true });

    await expect(
      followTarget({
        locale: "en",
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

  it("Return successful release", async () => {
    mockUnfollow.mockResolvedValueOnce({ isFollowing: false });

    await expect(
      unfollowTarget({
        locale: "en",
        publicId: "CREATOR01",
        targetKind: "creator",
        tenantId,
      })
    ).resolves.toEqual({ isFollowing: false, ok: true });
  });

  it("Unauthenticated rethrows for reauthentication", async () => {
    mockFollow.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    await expect(
      followTarget({
        locale: "en",
        publicId: "SERIES01",
        targetKind: "series",
        tenantId,
      })
    ).rejects.toBeInstanceOf(ConnectError);
  });
});
