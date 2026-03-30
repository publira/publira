import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPublishedAuthorDetail,
  listPublishedAuthors,
  normalizeAuthorsPage,
} from "./authors";

const { mockListPublishedSeries } = vi.hoisted(() => ({
  mockListPublishedSeries: vi.fn(),
}));

vi.mock("./catalog", () => ({
  listPublishedSeries: mockListPublishedSeries,
}));

describe("authors", () => {
  beforeEach(() => {
    mockListPublishedSeries.mockReset();
  });

  it("著者一覧をシリーズ実データから集約する", async () => {
    mockListPublishedSeries.mockResolvedValueOnce([
      {
        creatorNames: ["山田 太郎", "鈴木 花子", "山田 太郎"],
        creators: [
          {
            name: "山田 太郎",
            profileText: "",
            publicId: "CREATOR_YAMADA",
          },
          {
            name: "鈴木 花子",
            profileText: "",
            publicId: "CREATOR_SUZUKI",
          },
        ],
        labelName: "",
        publicId: "SERIES_1",
        synopsis: "",
        title: "シリーズ1",
      },
      {
        creatorNames: ["山田 太郎"],
        creators: [
          { name: "山田 太郎", profileText: "", publicId: "CREATOR_YAMADA" },
        ],
        labelName: "",
        publicId: "SERIES_2",
        synopsis: "",
        title: "シリーズ2",
      },
    ]);

    const result = await listPublishedAuthors("TENANT_1", {
      page: 1,
      pageSize: 10,
    });

    expect(mockListPublishedSeries).toHaveBeenCalledWith("TENANT_1", 50, 0);
    expect(result.authors).toHaveLength(2);
    expect(result.authors[0]?.id).toBe("CREATOR_YAMADA");
    expect(result.authors[0]?.name).toBe("山田 太郎");
    expect(result.authors[0]?.seriesCount).toBe(2);
    expect(result.authors[1]?.name).toBe("鈴木 花子");
    expect(result.authors[1]?.seriesCount).toBe(1);
    expect(result.hasNextPage).toBe(false);
  });

  it("ページングに応じて次ページ有無を返す", async () => {
    mockListPublishedSeries.mockResolvedValueOnce([
      {
        creatorNames: ["著者A"],
        creators: [{ name: "著者A", profileText: "", publicId: "CREATOR_A" }],
        labelName: "",
        publicId: "SERIES_1",
        synopsis: "",
        title: "シリーズ1",
      },
      {
        creatorNames: ["著者B"],
        creators: [{ name: "著者B", profileText: "", publicId: "CREATOR_B" }],
        labelName: "",
        publicId: "SERIES_2",
        synopsis: "",
        title: "シリーズ2",
      },
      {
        creatorNames: ["著者C"],
        creators: [{ name: "著者C", profileText: "", publicId: "CREATOR_C" }],
        labelName: "",
        publicId: "SERIES_3",
        synopsis: "",
        title: "シリーズ3",
      },
    ]);

    const result = await listPublishedAuthors("TENANT_1", {
      page: 1,
      pageSize: 2,
    });

    expect(result.authors).toHaveLength(2);
    expect(result.hasNextPage).toBe(true);
  });

  it("著者IDから著者詳細と関連シリーズを返す", async () => {
    const authorId = "CREATOR_A";

    mockListPublishedSeries.mockResolvedValueOnce([
      {
        creatorNames: ["著者A", "著者B"],
        creators: [
          {
            name: "著者A",
            profileText: "著者Aのプロフィール",
            publicId: "CREATOR_A",
          },
          { name: "著者B", profileText: "", publicId: "CREATOR_B" },
        ],
        labelName: "",
        publicId: "SERIES_1",
        synopsis: "",
        title: "シリーズ1",
      },
      {
        creatorNames: ["著者A"],
        creators: [
          {
            name: "著者A",
            profileText: "別シリーズのプロフィール",
            publicId: "CREATOR_A",
          },
        ],
        labelName: "",
        publicId: "SERIES_2",
        synopsis: "",
        title: "シリーズ2",
      },
    ]);

    const detail = await getPublishedAuthorDetail("TENANT_1", authorId);

    expect(detail?.name).toBe("著者A");
    expect(detail?.profileText).toBe("著者Aのプロフィール");
    expect(detail?.series).toEqual([
      { publicId: "SERIES_1", title: "シリーズ1" },
      { publicId: "SERIES_2", title: "シリーズ2" },
    ]);
  });

  it("存在しない著者IDは null を返す", async () => {
    mockListPublishedSeries.mockResolvedValueOnce([]);

    const detail = await getPublishedAuthorDetail(
      "TENANT_1",
      "UNKNOWN_CREATOR"
    );
    expect(detail).toBeNull();
    expect(mockListPublishedSeries).toHaveBeenCalledWith("TENANT_1", 50, 0);
  });

  it("page パラメータを正規化する", () => {
    expect(normalizeAuthorsPage()).toBe(1);
    expect(normalizeAuthorsPage("0")).toBe(1);
    expect(normalizeAuthorsPage("3")).toBe(3);
    expect(normalizeAuthorsPage(["2", "9"])).toBe(2);
  });
});
