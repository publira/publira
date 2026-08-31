import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPublishedAuthorDetail, listPublishedAuthors } from "./authors";

const { mockGetPublishedAuthorDetail, mockListPublishedAuthors } = vi.hoisted(
  () => ({
    mockGetPublishedAuthorDetail: vi.fn(),
    mockListPublishedAuthors: vi.fn(),
  })
);

vi.mock("./api-client", () => ({
  apiClient: {
    catalog: {
      getPublishedAuthorDetail: mockGetPublishedAuthorDetail,
      listPublishedAuthors: mockListPublishedAuthors,
    },
  },
}));

describe("listPublishedAuthors", () => {
  beforeEach(() => {
    mockListPublishedAuthors.mockReset();
  });

  it("Format public author and return cursor token", async () => {
    mockListPublishedAuthors.mockResolvedValueOnce({
      authors: [
        {
          iconImageUrl: "/images/creators/creator-yamada",
          name: "山田 太郎",
          publicId: "CREATOR_YAMADA",
          publishedSeriesCount: 2,
        },
        {
          iconImageUrl: "",
          name: "鈴木 花子",
          publicId: "CREATOR_SUZUKI",
          publishedSeriesCount: 1,
        },
      ],
      nextToken: "NEXT",
      previousToken: "PREV",
    });

    const result = await listPublishedAuthors(" TENANT_1 ", {
      limit: 12,
      locale: "ja",
      token: "abc",
    });

    expect(mockListPublishedAuthors).toHaveBeenCalledWith({
      limit: 12,
      tenant: { tenantId: "TENANT_1" },
      token: "abc",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        authors: [
          {
            iconImageUrl: "/images/creators/creator-yamada",
            id: "CREATOR_YAMADA",
            name: "山田 太郎",
            seriesCount: 2,
          },
          {
            iconImageUrl: "",
            id: "CREATOR_SUZUKI",
            name: "鈴木 花子",
            seriesCount: 1,
          },
        ],
        nextToken: "NEXT",
        previousToken: "PREV",
      },
    });
  });

  it("If token is omitted, get the first page", async () => {
    mockListPublishedAuthors.mockResolvedValueOnce({
      authors: [],
      nextToken: "",
      previousToken: "",
    });

    await listPublishedAuthors("TENANT_1", { locale: "ja" });

    expect(mockListPublishedAuthors).toHaveBeenCalledWith({
      limit: 20,
      tenant: { tenantId: "TENANT_1" },
      token: "",
    });
  });

  // A `"use cache"` function must not throw: the fill would fail the whole
  // request instead of reaching the awaiting page (#672).
  it("If acquisition fails, return the failure value without throwing", async () => {
    mockListPublishedAuthors.mockRejectedValueOnce(
      new ConnectError("connect ECONNREFUSED", Code.Unavailable)
    );

    await expect(
      listPublishedAuthors("TENANT_1", { locale: "ja" })
    ).resolves.toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
    });
  });
});

describe("getPublishedAuthorDetail", () => {
  beforeEach(() => {
    mockGetPublishedAuthorDetail.mockReset();
  });

  it("Return 1 page of author details and related series", async () => {
    mockGetPublishedAuthorDetail.mockResolvedValueOnce({
      author: {
        iconImageUrl: "/images/creators/creator-a",
        name: "著者A",
        profileText: "著者Aのプロフィール",
        publicId: "CREATOR_A",
        publishedSeriesCount: 3,
      },
      nextToken: "NEXT_SERIES",
      previousToken: "",
      series: [
        { publicId: "SERIES_1", title: "シリーズ1" },
        { publicId: "SERIES_2", title: "シリーズ2" },
      ],
    });

    const result = await getPublishedAuthorDetail(" TENANT_1 ", " CREATOR_A ", {
      limit: 12,
      locale: "ja",
      token: "",
    });

    expect(mockGetPublishedAuthorDetail).toHaveBeenCalledWith({
      limit: 12,
      publicId: "CREATOR_A",
      tenant: { tenantId: "TENANT_1" },
      token: "",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        iconImageUrl: "/images/creators/creator-a",
        id: "CREATOR_A",
        name: "著者A",
        nextToken: "NEXT_SERIES",
        previousToken: "",
        profileText: "著者Aのプロフィール",
        series: [
          { publicId: "SERIES_1", title: "シリーズ1" },
          { publicId: "SERIES_2", title: "シリーズ2" },
        ],
        seriesCount: 3,
      },
    });
  });

  it("Drop series lines without publicId", async () => {
    mockGetPublishedAuthorDetail.mockResolvedValueOnce({
      author: {
        iconImageUrl: "",
        name: "著者A",
        profileText: "",
        publicId: "CREATOR_A",
        publishedSeriesCount: 1,
      },
      nextToken: "",
      previousToken: "",
      series: [
        { publicId: "  ", title: "欠番" },
        { publicId: "SERIES_1", title: " シリーズ1 " },
      ],
    });

    const result = await getPublishedAuthorDetail("TENANT_1", "CREATOR_A", {
      locale: "ja",
    });

    expect(result.ok && result.value?.series).toEqual([
      { publicId: "SERIES_1", title: "シリーズ1" },
    ]);
  });

  it("null if author is missing", async () => {
    mockGetPublishedAuthorDetail.mockResolvedValueOnce({
      author: undefined,
      nextToken: "",
      previousToken: "",
      series: [],
    });

    await expect(
      getPublishedAuthorDetail("TENANT_1", "CREATOR_A", { locale: "ja" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("null if the API returns not_found", async () => {
    mockGetPublishedAuthorDetail.mockRejectedValueOnce(
      new ConnectError("author not found", Code.NotFound)
    );

    await expect(
      getPublishedAuthorDetail("TENANT_1", "UNKNOWN_CREATOR", { locale: "ja" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  // `"use cache"` re-creates a thrown error from name + message, dropping
  // `code`; classification has to survive on the message prefix alone.
  it("ConnectError regenerated at cache boundaries will also be null", async () => {
    const rehydrated = new Error("[not_found] author not found");
    rehydrated.name = "ConnectError";
    mockGetPublishedAuthorDetail.mockRejectedValueOnce(rehydrated);

    await expect(
      getPublishedAuthorDetail("TENANT_1", "CREATOR_A", { locale: "ja" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  // Another tenant's author comes back as permission_denied, not not_found.
  it("null if the API returns permission_denied", async () => {
    mockGetPublishedAuthorDetail.mockRejectedValueOnce(
      new ConnectError("author is not published", Code.PermissionDenied)
    );

    await expect(
      getPublishedAuthorDetail("TENANT_1", "CREATOR_A", { locale: "ja" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("Errors other than not_found are not thrown and return a failure value.", async () => {
    mockGetPublishedAuthorDetail.mockRejectedValueOnce(
      new ConnectError("connect ECONNREFUSED", Code.Unavailable)
    );

    await expect(
      getPublishedAuthorDetail("TENANT_1", "CREATOR_A", { locale: "ja" })
    ).resolves.toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
    });
  });
});
