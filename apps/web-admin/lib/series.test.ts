import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAccessToken, mockListSeries } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockListSeries: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    series: {
      listSeries: mockListSeries,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("listSeries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("cursor token と limit をそのまま渡し、応答のトークンを返す", async () => {
    mockListSeries.mockResolvedValue({
      defaultReadingPeriodHours: 72,
      nextToken: "next-page",
      previousToken: "previous-page",
      series: [],
    });

    const { listSeries } = await import("./series");
    const result = await listSeries("TENANT001", {
      limit: 20,
      token: "current-page",
    });

    expect(mockListSeries).toHaveBeenCalledWith(
      {
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "current-page",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({
      defaultReadingPeriodHours: 72,
      nextToken: "next-page",
      ok: true,
      previousToken: "previous-page",
    });
  });

  it("最初のページは空のトークンで取得する", async () => {
    mockListSeries.mockResolvedValue({ series: [] });

    const { listSeries } = await import("./series");
    const result = await listSeries("TENANT001");

    expect(mockListSeries).toHaveBeenCalledWith(
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
    mockListSeries.mockResolvedValue({
      series: [
        { creators: [], publicId: "SERIES002", synopsis: "", title: "ぬ" },
        { creators: [], publicId: "SERIES001", synopsis: "", title: "あ" },
      ],
    });

    const { listSeries } = await import("./series");
    const result = await listSeries("TENANT001");

    expect(result.series.map((item) => item.publicId)).toEqual([
      "SERIES002",
      "SERIES001",
    ]);
  });

  it("取得に失敗してもトークンなしの結果を返す", async () => {
    mockListSeries.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listSeries } = await import("./series");
    const result = await listSeries("TENANT001", { token: "current-page" });

    expect(result).toMatchObject({
      nextToken: "",
      ok: false,
      previousToken: "",
      series: [],
    });
  });
});

describe("listAllSeries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("cursor をたどって101件目以降も含め、タイトル順に返す", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      creators: [],
      publicId: `SERIES${String(index + 1).padStart(3, "0")}`,
      synopsis: "",
      title: `Series ${String(index + 1).padStart(3, "0")}`,
    }));
    mockListSeries
      .mockResolvedValueOnce({
        nextToken: "page-2",
        series: firstPage,
      })
      .mockResolvedValueOnce({
        nextToken: "",
        series: [
          { creators: [], publicId: "SERIES101", synopsis: "", title: "ぬ" },
          { creators: [], publicId: "SERIES102", synopsis: "", title: "あ" },
        ],
      });

    const { listAllSeries } = await import("./series");
    const result = await listAllSeries("TENANT001");

    expect(mockListSeries).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.series).toHaveLength(102);
    expect(result.series.some((item) => item.publicId === "SERIES101")).toBe(
      true
    );
    const aIndex = result.series.findIndex(
      (item) => item.publicId === "SERIES102"
    );
    const nuIndex = result.series.findIndex(
      (item) => item.publicId === "SERIES101"
    );
    expect(aIndex).toBeGreaterThanOrEqual(0);
    expect(nuIndex).toBeGreaterThan(aIndex);
  });

  it("セッションがない場合RPCを呼ばない", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listAllSeries } = await import("./series");
    const result = await listAllSeries("TENANT001");

    expect(mockListSeries).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      series: [],
    });
  });

  it("nextToken が繰り返されたら部分結果を返さない", async () => {
    mockListSeries
      .mockResolvedValueOnce({
        nextToken: "page-2",
        series: [
          { creators: [], publicId: "SERIES001", synopsis: "", title: "A" },
        ],
      })
      .mockResolvedValueOnce({
        nextToken: "page-2",
        series: [
          { creators: [], publicId: "SERIES002", synopsis: "", title: "B" },
        ],
      });

    const { listAllSeries } = await import("./series");
    const result = await listAllSeries("TENANT001");

    expect(result).toMatchObject({
      ok: false,
      series: [],
    });
  });
});
