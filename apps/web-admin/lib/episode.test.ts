import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAccessToken, mockListEpisodes, mockReorderEpisodes } =
  vi.hoisted(() => ({
    mockGetAccessToken: vi.fn(),
    mockListEpisodes: vi.fn(),
    mockReorderEpisodes: vi.fn(),
  }));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    series: {
      listEpisodes: mockListEpisodes,
      reorderEpisodes: mockReorderEpisodes,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const episode = (publicId: string, orderIndex: number) => ({
  orderIndex,
  price: 0,
  publicId,
  publishedAt: "",
  scheduledAt: "",
  status: "draft",
  title: publicId,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("listEpisodes", () => {
  it("cursor token と limit をそのまま渡し、応答のトークンを返す", async () => {
    mockListEpisodes.mockResolvedValue({
      episodes: [],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    const { listEpisodes } = await import("./episode");
    const result = await listEpisodes({
      limit: 20,
      seriesPublicId: "SERIES001",
      tenantId: "TENANT001",
      token: "current-page",
    });

    expect(mockListEpisodes).toHaveBeenCalledWith(
      {
        limit: 20,
        seriesPublicId: "SERIES001",
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

  it("最初のページは既定のページサイズと空のトークンで取得する", async () => {
    mockListEpisodes.mockResolvedValue({ episodes: [] });

    const { listEpisodes } = await import("./episode");
    const result = await listEpisodes({
      seriesPublicId: "SERIES001",
      tenantId: "TENANT001",
    });

    expect(mockListEpisodes).toHaveBeenCalledWith(
      {
        limit: 20,
        seriesPublicId: "SERIES001",
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
    mockListEpisodes.mockResolvedValue({
      episodes: [episode("EPISODE003", 3), episode("EPISODE001", 1)],
    });

    const { listEpisodes } = await import("./episode");
    const result = await listEpisodes({
      seriesPublicId: "SERIES001",
      tenantId: "TENANT001",
    });

    expect(result.episodes.map((item) => item.publicId)).toEqual([
      "EPISODE003",
      "EPISODE001",
    ]);
  });

  it("取得に失敗してもトークンなしの結果を返す", async () => {
    mockListEpisodes.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listEpisodes } = await import("./episode");
    const result = await listEpisodes({
      seriesPublicId: "SERIES001",
      tenantId: "TENANT001",
      token: "current-page",
    });

    expect(result).toMatchObject({
      episodes: [],
      nextToken: "",
      ok: false,
      previousToken: "",
    });
  });
});

describe("mergeEpisodeOrder", () => {
  it("ページ内の並びをシリーズ全体の同じ位置へ差し戻す", async () => {
    const { mergeEpisodeOrder } = await import("./episode");

    expect(
      mergeEpisodeOrder(["A", "B", "C", "D", "E"], ["C", "D"], ["D", "C"])
    ).toEqual(["A", "B", "D", "C", "E"]);
  });

  it("ページ外のエピソードが消えていても、ページの並びが保たれていれば書き込む", async () => {
    const { mergeEpisodeOrder } = await import("./episode");

    expect(mergeEpisodeOrder(["A", "C", "D"], ["C", "D"], ["D", "C"])).toEqual([
      "A",
      "D",
      "C",
    ]);
  });

  it("ページがシリーズと合わなくなっていたら諦める", async () => {
    const { mergeEpisodeOrder } = await import("./episode");

    // 既に削除されたエピソードを含むページ。
    expect(mergeEpisodeOrder(["A", "B"], ["B", "Z"], ["B", "Z"])).toBeNull();
    // 同じエピソードが二重に来たページ。
    expect(mergeEpisodeOrder(["A", "B"], ["A", "B"], ["B", "B"])).toBeNull();
    // 表示していた件数と送られてきた件数が合わないページ。
    expect(mergeEpisodeOrder(["A", "B"], ["A"], ["B", "A"])).toBeNull();
  });

  it("ページの間に別のエピソードが割り込んでいたら書き込まない", async () => {
    const { mergeEpisodeOrder } = await import("./episode");

    // 表示は [C, D] だったが、その間へ A と B が移動した。ID だけ見ると揃って
    // いるので、スロットへ流し込むと [D, A, B, C] になり無関係な行まで動く。
    expect(
      mergeEpisodeOrder(["C", "A", "B", "D"], ["C", "D"], ["D", "C"])
    ).toBeNull();
  });

  it("表示していた並びと現在の並びが食い違っていたら書き込まない", async () => {
    const { mergeEpisodeOrder } = await import("./episode");

    // 表示は [C, D] だったが、別の操作で [D, C] へ入れ替わっていた。
    expect(
      mergeEpisodeOrder(["A", "B", "D", "C"], ["C", "D"], ["D", "C"])
    ).toBeNull();
  });
});

describe("reorderEpisodePage", () => {
  it("シリーズ全体を読んでから、ページの並びを混ぜた全件を送る", async () => {
    mockListEpisodes
      .mockResolvedValueOnce({
        episodes: [episode("EPISODE001", 1), episode("EPISODE002", 2)],
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        episodes: [episode("EPISODE003", 3), episode("EPISODE004", 4)],
        nextToken: "",
      });
    mockReorderEpisodes.mockResolvedValue({ episodes: [] });

    const { reorderEpisodePage } = await import("./episode");
    const result = await reorderEpisodePage({
      currentEpisodePublicIds: ["EPISODE003", "EPISODE004"],
      episodePublicIds: ["EPISODE004", "EPISODE003"],
      seriesPublicId: "SERIES001",
      tenantId: "TENANT001",
    });

    expect(result.ok).toBe(true);
    expect(mockReorderEpisodes).toHaveBeenCalledWith(
      {
        episodePublicIds: [
          "EPISODE001",
          "EPISODE002",
          "EPISODE004",
          "EPISODE003",
        ],
        seriesPublicId: "SERIES001",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("並びが合わなくなっていたら RPC を呼ばない", async () => {
    mockListEpisodes.mockResolvedValue({
      episodes: [episode("EPISODE001", 1)],
      nextToken: "",
    });

    const { reorderEpisodePage } = await import("./episode");
    const result = await reorderEpisodePage({
      currentEpisodePublicIds: ["EPISODE002"],
      episodePublicIds: ["EPISODE002"],
      seriesPublicId: "SERIES001",
      tenantId: "TENANT001",
    });

    expect(result.ok).toBe(false);
    expect(mockReorderEpisodes).not.toHaveBeenCalled();
  });

  it("表示中に別の操作でページの並びが変わっていたら RPC を呼ばない", async () => {
    // 画面が [EPISODE003, EPISODE004] を表示している間に、EPISODE001 と
    // EPISODE002 がその間へ移動した。
    mockListEpisodes.mockResolvedValue({
      episodes: [
        episode("EPISODE003", 1),
        episode("EPISODE001", 2),
        episode("EPISODE002", 3),
        episode("EPISODE004", 4),
      ],
      nextToken: "",
    });

    const { reorderEpisodePage } = await import("./episode");
    const result = await reorderEpisodePage({
      currentEpisodePublicIds: ["EPISODE003", "EPISODE004"],
      episodePublicIds: ["EPISODE004", "EPISODE003"],
      seriesPublicId: "SERIES001",
      tenantId: "TENANT001",
    });

    expect(result.ok).toBe(false);
    expect(mockReorderEpisodes).not.toHaveBeenCalled();
  });

  it("シリーズの読み出しに失敗したら RPC を呼ばない", async () => {
    mockListEpisodes.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { reorderEpisodePage } = await import("./episode");
    const result = await reorderEpisodePage({
      currentEpisodePublicIds: ["EPISODE001"],
      episodePublicIds: ["EPISODE001"],
      seriesPublicId: "SERIES001",
      tenantId: "TENANT001",
    });

    expect(result.ok).toBe(false);
    expect(mockReorderEpisodes).not.toHaveBeenCalled();
  });
});
