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

const labelPage = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    name: `Label ${index + 1}`,
    publicId: `LABEL${String(index + 1).padStart(3, "0")}`,
  }));

describe("listLabels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("cursor token と limit をそのまま渡し、応答のトークンを返す", async () => {
    mockListLabels.mockResolvedValue({
      labels: [],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    const { listLabels } = await import("./label");
    const result = await listLabels("TENANT001", {
      limit: 20,
      token: "current-page",
    });

    expect(mockListLabels).toHaveBeenCalledWith(
      {
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "current-page",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({
      nextToken: "next-page",
      ok: true,
      previousToken: "previous-page",
    });
  });

  it("最初のページは空のトークンで取得する", async () => {
    mockListLabels.mockResolvedValue({ labels: [] });

    const { listLabels } = await import("./label");
    const result = await listLabels("TENANT001");

    expect(mockListLabels).toHaveBeenCalledWith(
      {
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    // トークン未指定の応答でも、呼び出し側が分岐せずに済むよう空文字へそろえる。
    expect(result).toMatchObject({
      nextToken: "",
      ok: true,
      previousToken: "",
    });
  });

  it("サーバーのキーセット順を並べ替えずに返す", async () => {
    mockListLabels.mockResolvedValue({
      labels: [
        { name: "ぬ", publicId: "LABEL002" },
        { name: "あ", publicId: "LABEL001" },
      ],
    });

    const { listLabels } = await import("./label");
    const result = await listLabels("TENANT001");

    expect(result.labels.map((item) => item.publicId)).toEqual([
      "LABEL002",
      "LABEL001",
    ]);
  });

  it("取得に失敗してもトークンなしの結果を返す", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockListLabels.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listLabels } = await import("./label");
    const result = await listLabels("TENANT001", { token: "current-page" });

    expect(result).toMatchObject({
      labels: [],
      nextToken: "",
      ok: false,
      previousToken: "",
    });
  });
});

describe("getLabel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("cursor をたどって101件目のレーベルを取得する", async () => {
    mockListLabels
      .mockResolvedValueOnce({
        labels: labelPage(100),
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

  it("listAllLabels は cursor をたどって101件目以降も含める", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      name: `Label ${String(index + 1).padStart(3, "0")}`,
      publicId: `LABEL${String(index + 1).padStart(3, "0")}`,
    }));
    mockListLabels
      .mockResolvedValueOnce({
        labels: firstPage,
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        labels: [
          { name: "Zebra", publicId: "LABEL101" },
          { name: "Alpha", publicId: "LABEL102" },
        ],
        nextToken: "",
      });

    const { listAllLabels } = await import("./label");
    const result = await listAllLabels("TENANT001");

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
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.labels).toHaveLength(102);
    expect(result.labels.at(0)?.publicId).toBe("LABEL102");
    expect(result.labels.at(-1)?.publicId).toBe("LABEL101");
    expect(result.labels.some((label) => label.publicId === "LABEL101")).toBe(
      true
    );
  });

  it("listAllLabels はセッションがない場合RPCを呼ばない", async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const { listAllLabels } = await import("./label");
    const result = await listAllLabels("TENANT001");

    expect(mockListLabels).not.toHaveBeenCalled();
    expect(result).toEqual({
      labels: [],
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      previousToken: "",
    });
  });
});
