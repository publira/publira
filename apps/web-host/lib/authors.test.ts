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

const seriesWithAuthor = (
  seriesId: string,
  authorId: string,
  authorName: string
) => ({
  creatorNames: [authorName],
  creators: [
    {
      iconImageUrl: "",
      name: authorName,
      profileText: "",
      publicId: authorId,
    },
  ],
  labelName: "",
  publicId: seriesId,
  synopsis: "",
  title: seriesId,
});

/**
 * One page with nothing after it, which is what these fixtures stand for.
 * `listPublishedSeries` answers with a `CachedReadResult`, never a throw (#672).
 */
const seriesPage = (series: unknown[]) => ({
  ok: true,
  value: { nextToken: "", previousToken: "", series },
});

describe("authors", () => {
  beforeEach(() => {
    mockListPublishedSeries.mockReset();
  });

  it("著者一覧をシリーズ実データから集約する", async () => {
    mockListPublishedSeries.mockResolvedValueOnce(
      seriesPage([
        {
          creatorNames: ["山田 太郎", "鈴木 花子", "山田 太郎"],
          creators: [
            {
              iconImageUrl: "/images/creators/creator-yamada",
              name: "山田 太郎",
              profileText: "",
              publicId: "CREATOR_YAMADA",
            },
            {
              iconImageUrl: "",
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
            {
              iconImageUrl: "/images/creators/creator-yamada",
              name: "山田 太郎",
              profileText: "",
              publicId: "CREATOR_YAMADA",
            },
          ],
          labelName: "",
          publicId: "SERIES_2",
          synopsis: "",
          title: "シリーズ2",
        },
      ])
    );

    const result = await listPublishedAuthors("TENANT_1", {
      page: 1,
      pageSize: 10,
    });

    expect(mockListPublishedSeries).toHaveBeenCalledWith("TENANT_1", {
      limit: 50,
      token: "",
    });
    expect(result.ok && result.value.authors).toHaveLength(2);
    expect(result.ok && result.value.authors[0]?.id).toBe("CREATOR_YAMADA");
    expect(result.ok && result.value.authors[0]?.iconImageUrl).toBe(
      "/images/creators/creator-yamada"
    );
    expect(result.ok && result.value.authors[0]?.name).toBe("山田 太郎");
    expect(result.ok && result.value.authors[0]?.seriesCount).toBe(2);
    expect(result.ok && result.value.authors[1]?.iconImageUrl).toBe("");
    expect(result.ok && result.value.authors[1]?.name).toBe("鈴木 花子");
    expect(result.ok && result.value.authors[1]?.seriesCount).toBe(1);
    expect(result.ok && result.value.hasNextPage).toBe(false);
  });

  it("ページングに応じて次ページ有無を返す", async () => {
    mockListPublishedSeries.mockResolvedValueOnce(
      seriesPage([
        {
          creatorNames: ["著者A"],
          creators: [
            {
              iconImageUrl: "",
              name: "著者A",
              profileText: "",
              publicId: "CREATOR_A",
            },
          ],
          labelName: "",
          publicId: "SERIES_1",
          synopsis: "",
          title: "シリーズ1",
        },
        {
          creatorNames: ["著者B"],
          creators: [
            {
              iconImageUrl: "",
              name: "著者B",
              profileText: "",
              publicId: "CREATOR_B",
            },
          ],
          labelName: "",
          publicId: "SERIES_2",
          synopsis: "",
          title: "シリーズ2",
        },
        {
          creatorNames: ["著者C"],
          creators: [
            {
              iconImageUrl: "",
              name: "著者C",
              profileText: "",
              publicId: "CREATOR_C",
            },
          ],
          labelName: "",
          publicId: "SERIES_3",
          synopsis: "",
          title: "シリーズ3",
        },
      ])
    );

    const result = await listPublishedAuthors("TENANT_1", {
      page: 1,
      pageSize: 2,
    });

    expect(result.ok && result.value.authors).toHaveLength(2);
    expect(result.ok && result.value.hasNextPage).toBe(true);
  });

  it("nextToken が返る限り次ページまで辿って集約する", async () => {
    mockListPublishedSeries.mockResolvedValueOnce({
      ok: true,
      value: {
        nextToken: "TOKEN_PAGE_2",
        previousToken: "",
        series: [seriesWithAuthor("SERIES_1", "CREATOR_A", "著者A")],
      },
    });
    mockListPublishedSeries.mockResolvedValueOnce(
      seriesPage([seriesWithAuthor("SERIES_2", "CREATOR_B", "著者B")])
    );

    const result = await listPublishedAuthors("TENANT_1", {
      page: 1,
      pageSize: 10,
    });

    expect(mockListPublishedSeries).toHaveBeenCalledTimes(2);
    expect(mockListPublishedSeries).toHaveBeenNthCalledWith(1, "TENANT_1", {
      limit: 50,
      token: "",
    });
    expect(mockListPublishedSeries).toHaveBeenNthCalledWith(2, "TENANT_1", {
      limit: 50,
      token: "TOKEN_PAGE_2",
    });
    expect(
      result.ok && result.value.authors.map((author) => author.id)
    ).toEqual(["CREATOR_A", "CREATOR_B"]);
    expect(result.ok && result.value.hasNextPage).toBe(false);
  });

  it("著者IDから著者詳細と関連シリーズを返す", async () => {
    const authorId = "CREATOR_A";

    mockListPublishedSeries.mockResolvedValueOnce(
      seriesPage([
        {
          creatorNames: ["著者A", "著者B"],
          creators: [
            {
              iconImageUrl: "/images/creators/creator-a",
              name: "著者A",
              profileText: "著者Aのプロフィール",
              publicId: "CREATOR_A",
            },
            {
              iconImageUrl: "",
              name: "著者B",
              profileText: "",
              publicId: "CREATOR_B",
            },
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
              iconImageUrl: "/images/creators/creator-a",
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
      ])
    );

    const detail = await getPublishedAuthorDetail("TENANT_1", authorId);

    expect(detail.ok && detail.value?.iconImageUrl).toBe(
      "/images/creators/creator-a"
    );
    expect(detail.ok && detail.value?.name).toBe("著者A");
    expect(detail.ok && detail.value?.profileText).toBe("著者Aのプロフィール");
    expect(detail.ok && detail.value?.series).toEqual([
      { publicId: "SERIES_1", title: "シリーズ1" },
      { publicId: "SERIES_2", title: "シリーズ2" },
    ]);
  });

  it("存在しない著者IDは null を返す", async () => {
    mockListPublishedSeries.mockResolvedValueOnce(seriesPage([]));

    const detail = await getPublishedAuthorDetail(
      "TENANT_1",
      "UNKNOWN_CREATOR"
    );
    expect(detail).toEqual({ ok: true, value: null });
    expect(mockListPublishedSeries).toHaveBeenCalledWith("TENANT_1", {
      limit: 50,
      token: "",
    });
  });

  it("著者詳細も nextToken が返る限り次ページまで辿る", async () => {
    mockListPublishedSeries.mockResolvedValueOnce({
      ok: true,
      value: {
        nextToken: "TOKEN_PAGE_2",
        previousToken: "",
        series: [seriesWithAuthor("SERIES_1", "CREATOR_A", "著者A")],
      },
    });
    mockListPublishedSeries.mockResolvedValueOnce(
      seriesPage([seriesWithAuthor("SERIES_2", "CREATOR_A", "著者A")])
    );

    const detail = await getPublishedAuthorDetail("TENANT_1", "CREATOR_A");

    expect(mockListPublishedSeries).toHaveBeenCalledTimes(2);
    expect(detail.ok && detail.value?.series).toEqual([
      { publicId: "SERIES_1", title: "SERIES_1" },
      { publicId: "SERIES_2", title: "SERIES_2" },
    ]);
  });

  it("同じ nextToken が繰り返されたら著者一覧の走査を止める", async () => {
    mockListPublishedSeries.mockResolvedValue({
      ok: true,
      value: {
        nextToken: "STUCK_TOKEN",
        previousToken: "",
        series: [seriesWithAuthor("SERIES_1", "CREATOR_A", "著者A")],
      },
    });

    const result = await listPublishedAuthors("TENANT_1", {
      page: 1,
      pageSize: 10,
    });

    // first page with "" then one more with the stuck token, then stop
    expect(mockListPublishedSeries).toHaveBeenCalledTimes(2);
    expect(result.ok && result.value.authors).toHaveLength(1);
  });

  /**
   * The walk is built on `listPublishedSeries`, which reports failure as a
   * value (#672). Half an author list would read as real data, so the failure
   * has to come out of the aggregation too.
   */
  it("シリーズ取得が失敗したら著者一覧・著者詳細も失敗を返す", async () => {
    mockListPublishedSeries.mockResolvedValue({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
    });

    await expect(
      listPublishedAuthors("TENANT_1", { page: 1, pageSize: 10 })
    ).resolves.toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
    });
    await expect(
      getPublishedAuthorDetail("TENANT_1", "CREATOR_A")
    ).resolves.toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
    });
  });

  it("page パラメータを正規化する", () => {
    expect(normalizeAuthorsPage()).toBe(1);
    expect(normalizeAuthorsPage("0")).toBe(1);
    expect(normalizeAuthorsPage("3")).toBe(3);
    expect(normalizeAuthorsPage(["2", "9"])).toBe(2);
  });
});
