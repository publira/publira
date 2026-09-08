import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMyReadingPosition, saveReadingPosition } from "./reading-position";

const {
  mockGetMyReadingPosition,
  mockResolveAccessToken,
  mockSaveReadingPosition,
} = vi.hoisted(() => ({
  mockGetMyReadingPosition: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockSaveReadingPosition: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    episodeRead: {
      getMyReadingPosition: mockGetMyReadingPosition,
      saveReadingPosition: mockSaveReadingPosition,
    },
  },
  buildSessionHeaders: (accessToken: string) => ({
    Authorization: `Bearer ${accessToken}`,
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EPISODE_PUBLIC_ID = "EPISODE_001";
const ACCESS_TOKEN = "session-token";

const target = { episodePublicId: EPISODE_PUBLIC_ID, tenantId: TENANT_ID };

describe("getMyReadingPosition", () => {
  beforeEach(() => {
    mockGetMyReadingPosition.mockResolvedValue({
      position: {
        episodePublicId: EPISODE_PUBLIC_ID,
        pageCount: 20,
        pageIndex: 11,
        updatedAt: "2026-09-01T00:00:00Z",
      },
    });
  });

  it("answers the page the member stopped on", async () => {
    await expect(
      getMyReadingPosition({ accessToken: ACCESS_TOKEN, ...target })
    ).resolves.toBe(11);
    expect(mockGetMyReadingPosition).toHaveBeenCalledWith(
      { episodePublicId: EPISODE_PUBLIC_ID, tenant: { tenantId: TENANT_ID } },
      { Authorization: "Bearer session-token" }
    );
  });

  it("answers nothing for a member who never opened the episode", async () => {
    mockGetMyReadingPosition.mockResolvedValue({});

    await expect(
      getMyReadingPosition({ accessToken: ACCESS_TOKEN, ...target })
    ).resolves.toBeNull();
  });

  it("leaves a guest alone", async () => {
    await expect(
      getMyReadingPosition({ accessToken: "", ...target })
    ).resolves.toBeNull();
    expect(mockGetMyReadingPosition).not.toHaveBeenCalled();
  });

  it("opens at the first page when the API refuses the read", async () => {
    mockGetMyReadingPosition.mockRejectedValue(
      new ConnectError("invalid session", Code.Unauthenticated)
    );

    await expect(
      getMyReadingPosition({ accessToken: ACCESS_TOKEN, ...target })
    ).resolves.toBeNull();
  });

  it("lets a failure it cannot explain reach the boundary", async () => {
    mockGetMyReadingPosition.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      getMyReadingPosition({ accessToken: ACCESS_TOKEN, ...target })
    ).rejects.toThrow("boom");
  });
});

describe("saveReadingPosition", () => {
  beforeEach(() => {
    mockResolveAccessToken.mockResolvedValue(ACCESS_TOKEN);
    mockSaveReadingPosition.mockResolvedValue({});
  });

  it("saves the page for the signed-in member", async () => {
    await saveReadingPosition({ pageIndex: 11, ...target });

    expect(mockSaveReadingPosition).toHaveBeenCalledWith(
      {
        episodePublicId: EPISODE_PUBLIC_ID,
        pageIndex: 11,
        tenant: { tenantId: TENANT_ID },
      },
      { Authorization: "Bearer session-token" }
    );
  });

  it("writes nothing for a reader without a session", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    await saveReadingPosition({ pageIndex: 11, ...target });

    expect(mockSaveReadingPosition).not.toHaveBeenCalled();
  });

  it("swallows an episode the member may no longer read", async () => {
    mockSaveReadingPosition.mockRejectedValue(
      new ConnectError("episode not found", Code.NotFound)
    );

    await expect(
      saveReadingPosition({ pageIndex: 11, ...target })
    ).resolves.toBeUndefined();
  });

  it("swallows a page the episode no longer has", async () => {
    mockSaveReadingPosition.mockRejectedValue(
      new ConnectError(
        "page index must be between 0 and 4",
        Code.InvalidArgument
      )
    );

    await expect(
      saveReadingPosition({ pageIndex: 11, ...target })
    ).resolves.toBeUndefined();
  });

  it("lets a failure it cannot explain reach the handler", async () => {
    mockSaveReadingPosition.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      saveReadingPosition({ pageIndex: 11, ...target })
    ).rejects.toThrow("boom");
  });
});
