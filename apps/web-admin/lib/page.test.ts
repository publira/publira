import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreatePage, mockGetAccessToken, mockListPages } = vi.hoisted(
  () => ({
    mockCreatePage: vi.fn(),
    mockGetAccessToken: vi.fn(),
    mockListPages: vi.fn(),
  })
);

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    pages: {
      createPage: mockCreatePage,
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
  });
});

const slugViolation = (reason = "") =>
  new ConnectError("invalid slug", Code.InvalidArgument, undefined, [
    {
      desc: BadRequestSchema,
      value: { fieldViolations: [{ field: "slug", reason }] },
    },
  ]);

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
