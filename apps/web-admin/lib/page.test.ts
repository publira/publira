import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAccessToken, mockListPages } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockListPages: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    pages: {
      listPages: mockListPages,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
}));

const page = (id: string, title: string) => ({
  createdAt: "2026-01-01T00:00:00Z",
  displayInFooter: false,
  id,
  publishedVersionId: "",
  slug: `/pages/${id}`,
  title,
  updatedAt: "2026-01-01T00:00:00Z",
});

describe("listPages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("cursor token と limit をそのまま渡し、応答のトークンを返す", async () => {
    mockListPages.mockResolvedValue({
      nextToken: "next-page",
      pages: [],
      previousToken: "previous-page",
    });

    const { listPages } = await import("./page");
    const result = await listPages("TENANT001", {
      limit: 20,
      token: "current-page",
    });

    expect(mockListPages).toHaveBeenCalledWith(
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
    mockListPages.mockResolvedValue({ pages: [] });

    const { listPages } = await import("./page");
    const result = await listPages("TENANT001");

    expect(mockListPages).toHaveBeenCalledWith(
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
    mockListPages.mockResolvedValue({
      pages: [page("PAGE002", "ぬ"), page("PAGE001", "あ")],
    });

    const { listPages } = await import("./page");
    const result = await listPages("TENANT001");

    expect(result.pages.map((item) => item.id)).toEqual(["PAGE002", "PAGE001"]);
  });

  it("セッションが無ければトークンなしの結果を返す", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listPages } = await import("./page");
    const result = await listPages("TENANT001", { token: "current-page" });

    expect(mockListPages).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      nextToken: "",
      ok: false,
      pages: [],
      previousToken: "",
    });
  });

  it("取得に失敗してもトークンなしの結果を返す", async () => {
    mockListPages.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listPages } = await import("./page");
    const result = await listPages("TENANT001", { token: "current-page" });

    expect(result).toMatchObject({
      nextToken: "",
      ok: false,
      pages: [],
      previousToken: "",
    });
  });
});
