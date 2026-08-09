import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPublishedPage,
  listPublishedPageLinks,
  normalizePublishedPageSlug,
  publishedPageHrefFromSlug,
} from "./pages";

const { mockGetPublishedPage, mockListPublishedPages } = vi.hoisted(() => ({
  mockGetPublishedPage: vi.fn(),
  mockListPublishedPages: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    pages: {
      getPublishedPage: mockGetPublishedPage,
      listPublishedPages: mockListPublishedPages,
    },
  },
}));

describe("normalizePublishedPageSlug", () => {
  it("空や / は空文字にする", () => {
    expect(normalizePublishedPageSlug("")).toBe("");
    expect(normalizePublishedPageSlug(" / ")).toBe("");
    expect(normalizePublishedPageSlug("/")).toBe("");
    expect(normalizePublishedPageSlug("//")).toBe("");
  });

  it("先頭スラッシュを正規化し、二重スラッシュを潰す", () => {
    expect(normalizePublishedPageSlug("privacy")).toBe("/privacy");
    expect(normalizePublishedPageSlug("/terms")).toBe("/terms");
    expect(normalizePublishedPageSlug("  /privacy  ")).toBe("/privacy");
    expect(normalizePublishedPageSlug("//privacy//")).toBe("/privacy");
    expect(normalizePublishedPageSlug("legal/terms")).toBe("/legal/terms");
    expect(normalizePublishedPageSlug(["legal", "terms"])).toBe("/legal/terms");
  });
});

describe("publishedPageHrefFromSlug", () => {
  it("公開 URL は storage slug と同じパスになる", () => {
    expect(publishedPageHrefFromSlug("/privacy")).toBe("/privacy");
    expect(publishedPageHrefFromSlug("legal/terms")).toBe("/legal/terms");
    expect(publishedPageHrefFromSlug("")).toBe("/");
  });
});

describe("listPublishedPageLinks", () => {
  beforeEach(() => {
    mockListPublishedPages.mockReset();
  });

  it("公開ページリンクを title と href に整形する", async () => {
    mockListPublishedPages.mockResolvedValueOnce({
      pages: [
        {
          displayInFooter: true,
          id: "page-1",
          slug: "/privacy",
          title: "プライバシーポリシー",
        },
        {
          displayInFooter: true,
          id: "page-2",
          slug: "/terms",
          title: "利用規約",
        },
      ],
    });

    const links = await listPublishedPageLinks("tenant-uuid");

    expect(mockListPublishedPages).toHaveBeenCalledWith({
      tenant: { tenantId: "tenant-uuid" },
    });
    expect(links).toEqual([
      {
        href: "/privacy",
        id: "page-1",
        label: "プライバシーポリシー",
        slug: "/privacy",
      },
      {
        href: "/terms",
        id: "page-2",
        label: "利用規約",
        slug: "/terms",
      },
    ]);
  });

  it("空テナントや API 失敗時は空配列を返す（失敗はキャッシュされない想定）", async () => {
    expect(await listPublishedPageLinks("")).toEqual([]);
    expect(mockListPublishedPages).not.toHaveBeenCalled();

    mockListPublishedPages.mockRejectedValueOnce(new Error("boom"));
    expect(await listPublishedPageLinks("tenant-uuid")).toEqual([]);
    expect(mockListPublishedPages).toHaveBeenCalledTimes(1);

    // A subsequent success after a soft failure still hits the API (failure was not cached).
    mockListPublishedPages.mockResolvedValueOnce({
      pages: [
        {
          displayInFooter: true,
          id: "page-1",
          slug: "/privacy",
          title: "プライバシーポリシー",
        },
      ],
    });
    const links = await listPublishedPageLinks("tenant-uuid");
    expect(mockListPublishedPages).toHaveBeenCalledTimes(2);
    expect(links).toEqual([
      {
        href: "/privacy",
        id: "page-1",
        label: "プライバシーポリシー",
        slug: "/privacy",
      },
    ]);
  });
});

describe("getPublishedPage", () => {
  beforeEach(() => {
    mockGetPublishedPage.mockReset();
  });

  it("公開ページを整形して返す", async () => {
    mockGetPublishedPage.mockResolvedValueOnce({
      page: {
        id: "page-1",
        slug: "/privacy",
        title: "プライバシーポリシー",
      },
      version: {
        contentMarkdown: "# 見出し\n\n本文",
        id: "ver-1",
        publishedAt: "2026-04-01T00:00:00Z",
        versionNumber: 2,
      },
    });

    const result = await getPublishedPage("tenant-uuid", "privacy");

    expect(mockGetPublishedPage).toHaveBeenCalledWith({
      slug: "/privacy",
      tenant: { tenantId: "tenant-uuid" },
    });
    expect(result).toEqual({
      contentMarkdown: "# 見出し\n\n本文",
      id: "page-1",
      publishedAt: "2026-04-01T00:00:00Z",
      slug: "/privacy",
      title: "プライバシーポリシー",
      versionId: "ver-1",
      versionNumber: 2,
    });
  });

  it("API not_found は null（呼び出し側が notFound() に倒す）", async () => {
    mockGetPublishedPage.mockRejectedValue(
      new ConnectError("page not found", Code.NotFound)
    );

    await expect(
      getPublishedPage("tenant-uuid", "missing")
    ).resolves.toBeNull();

    // Leading-slash form first, then bare form for legacy storage.
    expect(mockGetPublishedPage).toHaveBeenCalledWith({
      slug: "/missing",
      tenant: { tenantId: "tenant-uuid" },
    });
    expect(mockGetPublishedPage).toHaveBeenCalledWith({
      slug: "missing",
      tenant: { tenantId: "tenant-uuid" },
    });
  });

  it("先頭スラッシュ付きで not_found のとき legacy slug を試す", async () => {
    mockGetPublishedPage
      .mockRejectedValueOnce(new ConnectError("page not found", Code.NotFound))
      .mockResolvedValueOnce({
        page: {
          id: "page-1",
          slug: "privacy",
          title: "プライバシーポリシー",
        },
        version: {
          contentMarkdown: "body",
          id: "ver-1",
          publishedAt: "2026-04-01T00:00:00Z",
          versionNumber: 1,
        },
      });

    const result = await getPublishedPage("tenant-uuid", "privacy");
    expect(result?.slug).toBe("privacy");
    expect(mockGetPublishedPage).toHaveBeenNthCalledWith(1, {
      slug: "/privacy",
      tenant: { tenantId: "tenant-uuid" },
    });
    expect(mockGetPublishedPage).toHaveBeenNthCalledWith(2, {
      slug: "privacy",
      tenant: { tenantId: "tenant-uuid" },
    });
  });

  it("version が欠けている場合は null", async () => {
    mockGetPublishedPage.mockResolvedValueOnce({
      page: { id: "page-1", slug: "/privacy", title: "P" },
      version: undefined,
    });

    await expect(
      getPublishedPage("tenant-uuid", "privacy")
    ).resolves.toBeNull();
  });

  it("page.id が欠けている場合は null", async () => {
    mockGetPublishedPage.mockResolvedValueOnce({
      page: { slug: "/privacy", title: "P" },
      version: { contentMarkdown: "body", id: "ver-1", versionNumber: 1 },
    });

    await expect(
      getPublishedPage("tenant-uuid", "privacy")
    ).resolves.toBeNull();
  });

  it("ルート slug は null", async () => {
    await expect(getPublishedPage("tenant-uuid", "/")).resolves.toBeNull();
    expect(mockGetPublishedPage).not.toHaveBeenCalled();
  });

  it("空テナント ID は API を呼ばずに null", async () => {
    await expect(getPublishedPage("  ", "privacy")).resolves.toBeNull();
    expect(mockGetPublishedPage).not.toHaveBeenCalled();
  });

  /**
   * `internal` and friends are not "missing"; they must keep throwing so the
   * caller renders an error, not a 404.
   */
  it("分類できない RPC エラーは throw したまま", async () => {
    mockGetPublishedPage.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    await expect(getPublishedPage("tenant-uuid", "privacy")).rejects.toThrow(
      "boom"
    );
  });
});
