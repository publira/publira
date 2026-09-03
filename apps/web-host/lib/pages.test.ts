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
  it("Empty input and / normalize to an empty string", () => {
    expect(normalizePublishedPageSlug("")).toBe("");
    expect(normalizePublishedPageSlug(" / ")).toBe("");
    expect(normalizePublishedPageSlug("/")).toBe("");
    expect(normalizePublishedPageSlug("//")).toBe("");
  });

  it("Normalize leading slashes and crush double slashes", () => {
    expect(normalizePublishedPageSlug("privacy")).toBe("/privacy");
    expect(normalizePublishedPageSlug("/terms")).toBe("/terms");
    expect(normalizePublishedPageSlug("  /privacy  ")).toBe("/privacy");
    expect(normalizePublishedPageSlug("//privacy//")).toBe("/privacy");
    expect(normalizePublishedPageSlug("legal/terms")).toBe("/legal/terms");
    expect(normalizePublishedPageSlug(["legal", "terms"])).toBe("/legal/terms");
  });
});

describe("publishedPageHrefFromSlug", () => {
  it("The public URL will be the same path as the storage slug", () => {
    expect(publishedPageHrefFromSlug("/privacy")).toBe("/privacy");
    expect(publishedPageHrefFromSlug("legal/terms")).toBe("/legal/terms");
    expect(publishedPageHrefFromSlug("")).toBe("/");
  });
});

describe("listPublishedPageLinks", () => {
  beforeEach(() => {
    mockListPublishedPages.mockReset();
  });

  it("Format public page links into title and href", async () => {
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

  it("Returns an empty array in case of empty tenant or API failure (assuming failure is not cached)", async () => {
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

  it("Format and return public pages", async () => {
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

    const result = await getPublishedPage("tenant-uuid", "privacy", "ja");

    expect(mockGetPublishedPage).toHaveBeenCalledWith({
      slug: "/privacy",
      tenant: { tenantId: "tenant-uuid" },
    });
    expect(result).toEqual({
      ok: true,
      value: {
        contentMarkdown: "# 見出し\n\n本文",
        id: "page-1",
        publishedAt: "2026-04-01T00:00:00Z",
        slug: "/privacy",
        title: "プライバシーポリシー",
        versionId: "ver-1",
        versionNumber: 2,
      },
    });
  });

  it("API not_found is null (caller throws it to notFound())", async () => {
    mockGetPublishedPage.mockRejectedValue(
      new ConnectError("page not found", Code.NotFound)
    );

    await expect(
      getPublishedPage("tenant-uuid", "missing", "ja")
    ).resolves.toEqual({
      ok: true,
      value: null,
    });

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

  it("Try legacy slug when not_found with leading slash", async () => {
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

    const result = await getPublishedPage("tenant-uuid", "privacy", "ja");
    expect(result.ok && result.value?.slug).toBe("privacy");
    expect(mockGetPublishedPage).toHaveBeenNthCalledWith(1, {
      slug: "/privacy",
      tenant: { tenantId: "tenant-uuid" },
    });
    expect(mockGetPublishedPage).toHaveBeenNthCalledWith(2, {
      slug: "privacy",
      tenant: { tenantId: "tenant-uuid" },
    });
  });

  it("null if version is missing", async () => {
    mockGetPublishedPage.mockResolvedValueOnce({
      page: { id: "page-1", slug: "/privacy", title: "P" },
      version: undefined,
    });

    await expect(
      getPublishedPage("tenant-uuid", "privacy", "ja")
    ).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it("null if page.id is missing", async () => {
    mockGetPublishedPage.mockResolvedValueOnce({
      page: { slug: "/privacy", title: "P" },
      version: { contentMarkdown: "body", id: "ver-1", versionNumber: 1 },
    });

    await expect(
      getPublishedPage("tenant-uuid", "privacy", "ja")
    ).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it("root slug is null", async () => {
    await expect(getPublishedPage("tenant-uuid", "/", "ja")).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(mockGetPublishedPage).not.toHaveBeenCalled();
  });

  it("Empty tenant ID is null without calling API.", async () => {
    await expect(getPublishedPage("  ", "privacy", "ja")).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(mockGetPublishedPage).not.toHaveBeenCalled();
  });

  /**
   * `internal` and friends are not "missing": the page must render a failure,
   * not a 404. It comes back as a value because a `"use cache"` fill that
   * throws fails the whole request before the page can render either.
   */
  it("Unclassified RPC errors are not thrown but return a failure value.", async () => {
    mockGetPublishedPage.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      getPublishedPage("tenant-uuid", "privacy", "ja")
    ).resolves.toEqual({
      message:
        "ページの内容を取得できませんでした。時間をおいて再試行してください。",
      ok: false,
    });
  });
});
