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
