import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheTag, mockGetAccessToken, mockListLabels } = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockListLabels: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    label: {
      listLabels: mockListLabels,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("label lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("cursor をたどって101件目のレーベルを取得する", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      name: `Label ${index + 1}`,
      publicId: `LABEL${String(index + 1).padStart(3, "0")}`,
    }));
    mockListLabels
      .mockResolvedValueOnce({
        labels: firstPage,
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        labels: [{ name: "Target", publicId: "LABEL101" }],
        nextToken: "",
      });

    const { getLabel } = await import("./label");
    const result = await getLabel({
      publicId: "LABEL101",
      tenantId: "TENANT001",
    });

    expect(mockListLabels).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockListLabels).toHaveBeenNthCalledWith(
      2,
      {
        limit: 100,
        tenant: { tenantId: "TENANT001" },
        token: "page-2",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      label: {
        eyeCatchImageUpdatedAt: "",
        eyeCatchImageVariants: [],
        name: "Target",
        publicId: "LABEL101",
      },
      ok: true,
    });
  });
});
