import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordEpisodeRead } from "./episode-reads";

const { mockMarkEpisodeAsRead, mockResolveAccessToken } = vi.hoisted(() => ({
  mockMarkEpisodeAsRead: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: { episodeRead: { markEpisodeAsRead: mockMarkEpisodeAsRead } },
  buildSessionHeaders: (accessToken: string) => ({
    Authorization: `Bearer ${accessToken}`,
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PUBLIC_ID = "EPISODE_001";

describe("recordEpisodeRead", () => {
  beforeEach(() => {
    mockResolveAccessToken.mockResolvedValue("session-token");
    mockMarkEpisodeAsRead.mockResolvedValue({ readAt: "2026-08-31T00:00:00Z" });
  });

  it("records the read for the signed-in member", async () => {
    await recordEpisodeRead({ publicId: PUBLIC_ID, tenantId: TENANT_ID });

    expect(mockMarkEpisodeAsRead).toHaveBeenCalledWith(
      { episodePublicId: PUBLIC_ID, tenant: { tenantId: TENANT_ID } },
      { Authorization: "Bearer session-token" }
    );
  });

  it("writes nothing for a reader without a session", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    await recordEpisodeRead({ publicId: PUBLIC_ID, tenantId: TENANT_ID });

    expect(mockMarkEpisodeAsRead).not.toHaveBeenCalled();
  });

  it("swallows an episode the member may no longer read", async () => {
    mockMarkEpisodeAsRead.mockRejectedValue(
      new ConnectError("episode not found", Code.NotFound)
    );

    await expect(
      recordEpisodeRead({ publicId: PUBLIC_ID, tenantId: TENANT_ID })
    ).resolves.toBeUndefined();
  });

  it("swallows a session the API rejected", async () => {
    mockMarkEpisodeAsRead.mockRejectedValue(
      new ConnectError("invalid session", Code.Unauthenticated)
    );

    await expect(
      recordEpisodeRead({ publicId: PUBLIC_ID, tenantId: TENANT_ID })
    ).resolves.toBeUndefined();
  });

  it("lets a failure it cannot explain reach the handler", async () => {
    mockMarkEpisodeAsRead.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      recordEpisodeRead({ publicId: PUBLIC_ID, tenantId: TENANT_ID })
    ).rejects.toThrow("boom");
  });
});
