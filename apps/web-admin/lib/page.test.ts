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
