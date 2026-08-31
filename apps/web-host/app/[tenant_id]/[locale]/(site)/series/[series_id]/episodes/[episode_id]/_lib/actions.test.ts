import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAssertSameOrigin, mockMarkEpisodeAsRead, mockResolveAccessToken } =
  vi.hoisted(() => ({
    mockAssertSameOrigin: vi.fn(),
    mockMarkEpisodeAsRead: vi.fn(),
    mockResolveAccessToken: vi.fn(),
  }));

vi.mock("#lib/api-client", () => ({
  apiClient: { episodeRead: { markEpisodeAsRead: mockMarkEpisodeAsRead } },
  buildSessionHeaders: (accessToken: string) => ({
    Authorization: `Bearer ${accessToken}`,
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

const { markEpisodeAsReadAction } = await import("./actions");

const episodePublicId = "EPISODE_001";
const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("markEpisodeAsReadAction", () => {
  beforeEach(() => {
    mockResolveAccessToken.mockResolvedValue("session-token");
    mockMarkEpisodeAsRead.mockResolvedValue({ readAt: "2026-08-31T00:00:00Z" });
  });

  it("records the read for the signed-in member", async () => {
    await expect(
      markEpisodeAsReadAction({ episodePublicId, tenantId })
    ).resolves.toBe(true);

    expect(mockAssertSameOrigin).toHaveBeenCalledOnce();
    expect(mockMarkEpisodeAsRead).toHaveBeenCalledWith(
      { episodePublicId, tenant: { tenantId } },
      { Authorization: "Bearer session-token" }
    );
  });

  it("writes nothing for a reader without a session", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    await expect(
      markEpisodeAsReadAction({ episodePublicId, tenantId })
    ).resolves.toBe(false);
    expect(mockMarkEpisodeAsRead).not.toHaveBeenCalled();
  });

  it("rejects a tenant id that did not come through the site", async () => {
    await expect(
      markEpisodeAsReadAction({ episodePublicId, tenantId: "not-a-tenant" })
    ).resolves.toBe(false);
    expect(mockMarkEpisodeAsRead).not.toHaveBeenCalled();
  });

  it("reports an episode the member may no longer read as unrecorded", async () => {
    mockMarkEpisodeAsRead.mockRejectedValue(
      new ConnectError("episode not found", Code.NotFound)
    );

    await expect(
      markEpisodeAsReadAction({ episodePublicId, tenantId })
    ).resolves.toBe(false);
  });

  it("reports a rejected session as unrecorded rather than re-authenticating", async () => {
    mockMarkEpisodeAsRead.mockRejectedValue(
      new ConnectError("invalid session", Code.Unauthenticated)
    );

    await expect(
      markEpisodeAsReadAction({ episodePublicId, tenantId })
    ).resolves.toBe(false);
  });

  it("lets a failure it cannot explain reach the caller", async () => {
    mockMarkEpisodeAsRead.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      markEpisodeAsReadAction({ episodePublicId, tenantId })
    ).rejects.toThrow("boom");
  });
});
