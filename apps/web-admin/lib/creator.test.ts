import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheTag, mockGetAccessToken, mockListCreators } = vi.hoisted(
  () => ({
    mockCacheTag: vi.fn(),
    mockGetAccessToken: vi.fn(),
    mockListCreators: vi.fn(),
  })
);

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    creator: {
      listCreators: mockListCreators,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("creator lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("cursor をたどって101件目の著者を取得する", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      name: `Creator ${index + 1}`,
      profileText: "",
      publicId: `CREATOR${String(index + 1).padStart(3, "0")}`,
    }));
    mockListCreators
      .mockResolvedValueOnce({
        creators: firstPage,
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        creators: [
          { name: "Target", profileText: "profile", publicId: "CREATOR101" },
        ],
        nextToken: "",
      });

    const { getCreator } = await import("./creator");
    const result = await getCreator({
      publicId: "CREATOR101",
      tenantId: "TENANT001",
    });

    expect(mockListCreators).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockListCreators).toHaveBeenNthCalledWith(
      2,
      {
        limit: 100,
        tenant: { tenantId: "TENANT001" },
        token: "page-2",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      creator: {
        iconImageFileSizeBytes: 0,
        iconImageUpdatedAt: "",
        iconImageUrl: "",
        name: "Target",
        profileText: "profile",
        publicId: "CREATOR101",
      },
      ok: true,
    });
  });
});
