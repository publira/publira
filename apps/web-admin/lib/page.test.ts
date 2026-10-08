import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockCreatePage,
  mockCreatePageTranslation,
  mockCreateVersion,
  mockDeletePageTranslation,
  mockGetAccessToken,
  mockGetPage,
  mockListPages,
  mockListPageTranslations,
  mockListVersions,
  mockUpdatePage,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockCreatePage: vi.fn(),
  mockCreatePageTranslation: vi.fn(),
  mockCreateVersion: vi.fn(),
  mockDeletePageTranslation: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetPage: vi.fn(),
  mockListPageTranslations: vi.fn(),
  mockListPages: vi.fn(),
  mockListVersions: vi.fn(),
  mockUpdatePage: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    pages: {
      createPage: mockCreatePage,
      createPageTranslation: mockCreatePageTranslation,
      createVersion: mockCreateVersion,
      deletePageTranslation: mockDeletePageTranslation,
      getPage: mockGetPage,
      listPageTranslations: mockListPageTranslations,
      listPages: mockListPages,
      listVersions: mockListVersions,
      updatePage: mockUpdatePage,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
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

  it("passes the cursor token and the limit through and returns the tokens of the response", async () => {
    mockListPages.mockResolvedValue({
      nextToken: "next-page",
      pages: [],
      previousToken: "previous-page",
    });

    const { listPages } = await import("./page");
    const result = await listPages("TENANT001", "en", {
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
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("fetches the first page with an empty token", async () => {
    mockListPages.mockResolvedValue({ pages: [] });

    const { listPages } = await import("./page");
    const result = await listPages("TENANT001", "en", {});

    expect(mockListPages).toHaveBeenCalledWith(
      {
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    // A response that names no token still answers with empty strings, so the
    // caller never has to branch on their absence.
    expect(result).toMatchObject({
      nextToken: "",
      ok: true,
      previousToken: "",
    });
  });

  it("returns the keyset order of the server without re-sorting it", async () => {
    mockListPages.mockResolvedValue({
      pages: [page("PAGE002", "Zulu"), page("PAGE001", "Alpha")],
    });

    const { listPages } = await import("./page");
    const result = await listPages("TENANT001", "en", {});

    expect(result.pages.map((item) => item.id)).toEqual(["PAGE002", "PAGE001"]);
  });

  it("returns a result with no token when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listPages } = await import("./page");
    const result = await listPages("TENANT001", "en", {
      token: "current-page",
    });

    expect(mockListPages).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      nextToken: "",
      ok: false,
      pages: [],
      previousToken: "",
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("returns a result with no token when the fetch fails", async () => {
    mockListPages.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listPages } = await import("./page");
    const result = await listPages("TENANT001", "en", {
      token: "current-page",
    });

    expect(result).toMatchObject({
      nextToken: "",
      ok: false,
      pages: [],
      previousToken: "",
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

const slugViolation = (reason = "") =>
  new ConnectError("invalid slug", Code.InvalidArgument, undefined, [
    {
      desc: BadRequestSchema,
      value: { fieldViolations: [{ field: "slug", reason }] },
    },
  ]);

describe("listPublishedPages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("walks every page of the list and keeps only the published pages, sorted by title", async () => {
    mockListPages
      .mockResolvedValueOnce({
        nextToken: "second",
        pages: [
          { ...page("p1", "Terms"), publishedVersionId: "v1" },
          page("p2", "Draft"),
        ],
      })
      .mockResolvedValueOnce({
        nextToken: "",
        pages: [{ ...page("p3", "Privacy"), publishedVersionId: "v3" }],
      });

    const { listPublishedPages } = await import("./page");
    const result = await listPublishedPages("TENANT001", "en");

    expect(mockListPages).toHaveBeenNthCalledWith(
      2,
      { limit: 100, tenant: { tenantId: "TENANT001" }, token: "second" },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({
      ok: true,
      pages: [
        { id: "p3", title: "Privacy" },
        { id: "p1", title: "Terms" },
      ],
    });
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  // A partial list would read as "these are all the published pages" and hide
  // the rest from the picker.
  it("fails rather than answering a list whose walk did not finish", async () => {
    mockListPages.mockResolvedValue({
      nextToken: "same",
      pages: [{ ...page("p1", "Terms"), publishedVersionId: "v1" }],
    });

    const { listPublishedPages } = await import("./page");
    const result = await listPublishedPages("TENANT001", "en");

    expect(result).toEqual({
      message: "Could not load the page. Please try again later.",
      ok: false,
      requiresSignIn: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("asks for a sign-in when there is no session", async () => {
    mockGetAccessToken.mockResolvedValueOnce("");

    const { listPublishedPages } = await import("./page");
    const result = await listPublishedPages("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockListPages).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a failed page of the walk as a message", async () => {
    mockListPages.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listPublishedPages } = await import("./page");
    const result = await listPublishedPages("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: false });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("createPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  const input = { slug: "/login", tenantId: "TENANT001", title: "Help" };

  it("puts a reserved slug on the slug field with its own message", async () => {
    mockCreatePage.mockRejectedValue(slugViolation("PAGE_SLUG_RESERVED"));

    const { createPage } = await import("./page");
    const result = await createPage(input, "en");

    expect(result).toEqual({
      field: "slug",
      message:
        "The site keeps this path for signing in, signing up, the links in its emails, or account settings. Choose a different slug.",
      ok: false,
    });
  });

  it("puts a slug the site answers before its pages on the slug field with its own message", async () => {
    mockCreatePage.mockRejectedValue(slugViolation("PAGE_SLUG_UNREACHABLE"));

    const { createPage } = await import("./page");
    const result = await createPage({ ...input, slug: "/ja" }, "en");

    expect(result).toEqual({
      field: "slug",
      message:
        "The site answers this path itself, as a language prefix, its API, or a health check, before it looks for a page. Choose a different slug.",
      ok: false,
    });
  });

  it("puts a malformed slug on the slug field", async () => {
    mockCreatePage.mockRejectedValue(slugViolation());

    const { createPage } = await import("./page");
    const result = await createPage(input, "en");

    expect(result).toMatchObject({ field: "slug", ok: false });
    expect(result.ok ? "" : result.message).toContain("lowercase letters");
  });

  it("puts a duplicate slug on the slug field", async () => {
    mockCreatePage.mockRejectedValue(
      new ConnectError("exists", Code.AlreadyExists)
    );

    const { createPage } = await import("./page");
    const result = await createPage(input, "en");

    expect(result).toMatchObject({ field: "slug", ok: false });
  });

  it("leaves a failure that is not about the slug on the form", async () => {
    mockCreatePage.mockRejectedValue(
      new ConnectError("unavailable", Code.Unavailable)
    );

    const { createPage } = await import("./page");
    const result = await createPage(input, "en");

    expect(result).not.toHaveProperty("field");
    expect(result.ok).toBe(false);
  });
});

const SESSION_HEADERS = { headers: { Authorization: "Bearer session-token" } };

const translation = (locale: string, title: string) => ({
  createdAt: "2026-01-01T00:00:00Z",
  id: `TRANSLATION-${locale}`,
  locale,
  pageId: "PAGE001",
  publishedVersionId: "",
  title,
  updatedAt: "2026-01-01T00:00:00Z",
});

describe("updatePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
    mockUpdatePage.mockResolvedValue({ page: page("PAGE001", "Help") });
  });

  it("leaves the title out of a request that does not set it", async () => {
    const { updatePage } = await import("./page");

    await updatePage(
      { displayInFooter: true, pageId: "PAGE001", tenantId: "TENANT001" },
      "en"
    );

    const [request] = mockUpdatePage.mock.calls[0] ?? [];
    expect(request).toEqual(expect.objectContaining({ displayInFooter: true }));
    expect(request).not.toHaveProperty("title");
  });

  it("leaves Show in footer out of a request that does not set it", async () => {
    const { updatePage } = await import("./page");

    await updatePage(
      { pageId: "PAGE001", tenantId: "TENANT001", title: "Help" },
      "en"
    );

    const [request] = mockUpdatePage.mock.calls[0] ?? [];
    expect(request).toEqual(expect.objectContaining({ title: "Help" }));
    expect(request).not.toHaveProperty("displayInFooter");
  });
});

describe("listPageTranslations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns the translations in the server's order, under the page's tags", async () => {
    mockListPageTranslations.mockResolvedValue({
      translations: [
        translation("ja", "Privacy policy (ja)"),
        translation("en", "Privacy policy"),
      ],
    });

    const { listPageTranslations } = await import("./page");
    const result = await listPageTranslations(
      { pageId: "PAGE001", tenantId: "TENANT001" },
      "en"
    );

    expect(mockListPageTranslations).toHaveBeenCalledWith(
      { pageId: "PAGE001", tenant: { tenantId: "TENANT001" } },
      SESSION_HEADERS
    );
    expect(result).toEqual({
      ok: true,
      translations: [
        {
          id: "TRANSLATION-ja",
          locale: "ja",
          publishedVersionId: "",
          title: "Privacy policy (ja)",
        },
        {
          id: "TRANSLATION-en",
          locale: "en",
          publishedVersionId: "",
          title: "Privacy policy",
        },
      ],
    });
    expect(mockCacheTag).toHaveBeenCalledWith("pages-TENANT001");
    expect(mockCacheTag).toHaveBeenCalledWith("page-TENANT001-PAGE001");
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("leaves out a translation in a locale this build does not serve", async () => {
    mockListPageTranslations.mockResolvedValue({
      translations: [
        translation("ja", "Privacy policy (ja)"),
        translation("fr", "Politique de confidentialité"),
      ],
    });

    const { listPageTranslations } = await import("./page");
    const result = await listPageTranslations(
      { pageId: "PAGE001", tenantId: "TENANT001" },
      "en"
    );

    expect(
      result.ok ? result.translations.map((item) => item.locale) : []
    ).toEqual(["ja"]);
  });

  it("reports a page that is missing as not found", async () => {
    mockListPageTranslations.mockRejectedValue(
      new ConnectError("page not found", Code.NotFound)
    );

    const { listPageTranslations } = await import("./page");
    const result = await listPageTranslations(
      { pageId: "PAGE404", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({ notFound: true, ok: false });
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("asks for a sign-in without calling the RPC when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listPageTranslations } = await import("./page");
    const result = await listPageTranslations(
      { pageId: "PAGE001", tenantId: "TENANT001" },
      "en"
    );

    expect(mockListPageTranslations).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a failure other than a missing page as a message", async () => {
    mockListPageTranslations.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listPageTranslations } = await import("./page");
    const result = await listPageTranslations(
      { pageId: "PAGE001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toMatchObject({ ok: false, requiresSignIn: false });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("getPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns the page without dropping the cache entry", async () => {
    mockGetPage.mockResolvedValue({ page: page("PAGE001", "Privacy") });

    const { getPage } = await import("./page");
    const result = await getPage(
      { pageId: "PAGE001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toMatchObject({ ok: true, page: { id: "PAGE001" } });
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("asks for a sign-in without calling the RPC when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getPage } = await import("./page");
    const result = await getPage(
      { pageId: "PAGE001", tenantId: "TENANT001" },
      "en"
    );

    expect(mockGetPage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("keeps a missing page as a cacheable not found", async () => {
    mockGetPage.mockRejectedValue(
      new ConnectError("page not found", Code.NotFound)
    );

    const { getPage } = await import("./page");
    const result = await getPage(
      { pageId: "PAGE404", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({ notFound: true, ok: false });
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("reports a failure other than a missing page as a message", async () => {
    mockGetPage.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { getPage } = await import("./page");
    const result = await getPage(
      { pageId: "PAGE001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toMatchObject({ ok: false, requiresSignIn: false });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("listPageVersions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns the versions without dropping the cache entry", async () => {
    mockListVersions.mockResolvedValue({
      versions: [
        {
          contentMarkdown: "# Privacy",
          id: "VERSION001",
          pageId: "PAGE001",
          status: "published",
          versionNumber: 1,
        },
      ],
    });

    const { listPageVersions } = await import("./page");
    const result = await listPageVersions(
      { pageId: "PAGE001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toMatchObject({
      ok: true,
      versions: [{ id: "VERSION001", status: "published" }],
    });
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("asks for a sign-in without calling the RPC when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listPageVersions } = await import("./page");
    const result = await listPageVersions(
      { pageId: "PAGE001", tenantId: "TENANT001" },
      "en"
    );

    expect(mockListVersions).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      requiresSignIn: true,
      versions: [],
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a failed read as a message", async () => {
    mockListVersions.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listPageVersions } = await import("./page");
    const result = await listPageVersions(
      { pageId: "PAGE001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toMatchObject({
      ok: false,
      requiresSignIn: false,
      versions: [],
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("the translation a page RPC works on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("names the translation's locale in the request", async () => {
    mockGetPage.mockResolvedValue({
      page: { ...page("PAGE001", "Privacy"), locale: "en" },
    });

    const { getPage } = await import("./page");
    const result = await getPage(
      { pageId: "PAGE001", tenantId: "TENANT001", translationLocale: "en" },
      "en"
    );

    expect(mockGetPage).toHaveBeenCalledWith(
      { locale: "en", pageId: "PAGE001", tenant: { tenantId: "TENANT001" } },
      SESSION_HEADERS
    );
    expect(result).toMatchObject({ ok: true, page: { locale: "en" } });
  });

  it("leaves the locale empty for the translation the tenant's default resolves to", async () => {
    mockCreateVersion.mockResolvedValue({
      version: { id: "VERSION001", pageId: "PAGE001" },
    });

    const { createPageVersion } = await import("./page");
    await createPageVersion(
      {
        contentMarkdown: "# Privacy",
        pageId: "PAGE001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockCreateVersion).toHaveBeenCalledWith(
      {
        contentMarkdown: "# Privacy",
        locale: "",
        pageId: "PAGE001",
        tenant: { tenantId: "TENANT001" },
      },
      SESSION_HEADERS
    );
  });
});

describe("createPageTranslation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  const input = {
    pageId: "PAGE001",
    tenantId: "TENANT001",
    title: "Privacy policy",
    translationLocale: "en" as const,
  };

  it("returns the translation it added", async () => {
    mockCreatePageTranslation.mockResolvedValue({
      translation: translation("en", "Privacy policy"),
    });

    const { createPageTranslation } = await import("./page");
    const result = await createPageTranslation(input, "en");

    expect(mockCreatePageTranslation).toHaveBeenCalledWith(
      {
        locale: "en",
        pageId: "PAGE001",
        tenant: { tenantId: "TENANT001" },
        title: "Privacy policy",
      },
      SESSION_HEADERS
    );
    expect(result).toMatchObject({
      ok: true,
      translation: { locale: "en", title: "Privacy policy" },
    });
  });

  it("says the page already has a translation in that locale", async () => {
    mockCreatePageTranslation.mockRejectedValue(
      new ConnectError("exists", Code.AlreadyExists)
    );

    const { createPageTranslation } = await import("./page");
    const result = await createPageTranslation(input, "en");

    expect(result).toEqual({
      message:
        "This page already has a translation in that language. Reload the page.",
      ok: false,
    });
  });
});

describe("deletePageTranslation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  const input = {
    pageId: "PAGE001",
    tenantId: "TENANT001",
    translationLocale: "ja" as const,
  };

  it("deletes the translation in the locale it names", async () => {
    mockDeletePageTranslation.mockResolvedValue({});

    const { deletePageTranslation } = await import("./page");
    const result = await deletePageTranslation(input, "en");

    expect(mockDeletePageTranslation).toHaveBeenCalledWith(
      { locale: "ja", pageId: "PAGE001", tenant: { tenantId: "TENANT001" } },
      SESSION_HEADERS
    );
    expect(result).toEqual({ ok: true });
  });

  it("explains why the page's last translation stays", async () => {
    mockDeletePageTranslation.mockRejectedValue(
      new ConnectError("last translation", Code.FailedPrecondition)
    );

    const { deletePageTranslation } = await import("./page");
    const result = await deletePageTranslation(input, "en");

    expect(result).toEqual({
      message:
        "A page keeps at least one translation, so its last one cannot be deleted.",
      ok: false,
    });
  });
});
