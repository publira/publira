import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheTag, mockGetAccessToken, mockGetCreator, mockListCreators } =
  vi.hoisted(() => ({
    mockCacheTag: vi.fn(),
    mockGetAccessToken: vi.fn(),
    mockGetCreator: vi.fn(),
    mockListCreators: vi.fn(),
  }));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    creator: {
      getCreator: mockGetCreator,
      listCreators: mockListCreators,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const creatorPage = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    name: `Creator ${index + 1}`,
    profileText: "",
    publicId: `CREATOR${String(index + 1).padStart(3, "0")}`,
  }));

describe("listCreators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("passes the cursor token and the limit through and returns the tokens of the response", async () => {
    mockListCreators.mockResolvedValue({
      creators: [],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    const { listCreators } = await import("./creator");
    const result = await listCreators("TENANT001", "en", {
      limit: 20,
      token: "current-page",
    });

    expect(mockListCreators).toHaveBeenCalledWith(
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
    mockListCreators.mockResolvedValue({ creators: [] });

    const { listCreators } = await import("./creator");
    const result = await listCreators("TENANT001", "en", {});

    expect(mockListCreators).toHaveBeenCalledWith(
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
    mockListCreators.mockResolvedValue({
      creators: [
        { name: "Zulu", profileText: "", publicId: "CREATOR002" },
        { name: "Alpha", profileText: "", publicId: "CREATOR001" },
      ],
    });

    const { listCreators } = await import("./creator");
    const result = await listCreators("TENANT001", "en", {});

    expect(result.creators.map((item) => item.publicId)).toEqual([
      "CREATOR002",
      "CREATOR001",
    ]);
  });

  it("returns a result with no token when the fetch fails", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockListCreators.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listCreators } = await import("./creator");
    const result = await listCreators("TENANT001", "en", {
      token: "current-page",
    });

    expect(result).toMatchObject({
      creators: [],
      nextToken: "",
      ok: false,
      previousToken: "",
    });
  });
});

describe("getCreator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("calls GetCreator once instead of walking the list", async () => {
    mockGetCreator.mockResolvedValue({
      creator: {
        name: "Target",
        profileText: "profile",
        publicId: "CREATOR101",
      },
    });

    const { getCreator } = await import("./creator");
    const result = await getCreator(
      {
        publicId: "CREATOR101",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockGetCreator).toHaveBeenCalledExactlyOnceWith(
      {
        publicId: "CREATOR101",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockListCreators).not.toHaveBeenCalled();
    expect(result).toEqual({
      creator: {
        iconImageFileSizeBytes: 0,
        iconImageUpdatedAt: "",
        iconImageUrl: "",
        name: "Target",
        profileText: "profile",
        publicId: "CREATOR101",
      },
      ok: true,
    });
  });

  it("returns an error without calling the RPC when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const { getCreator } = await import("./creator");
    const result = await getCreator(
      {
        publicId: "CREATOR001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockGetCreator).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
  });

  // The server answers not_found both for a record that does not exist and
  // for one outside the tenant, so neither is distinguished here: both fall
  // through to notFound.
  it("returns notFound when the RPC answers not_found", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockGetCreator.mockRejectedValue(
      new ConnectError("creator not found", Code.NotFound)
    );

    const { getCreator } = await import("./creator");
    const result = await getCreator(
      {
        publicId: "MISSING",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({ notFound: true, ok: false });
  });

  it("returns a message for a failure other than not_found", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockGetCreator.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { getCreator } = await import("./creator");
    const result = await getCreator(
      {
        publicId: "CREATOR001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(false);
    expect(result).not.toMatchObject({ notFound: true });
  });

  it("treats a response with no creator as an error", async () => {
    mockGetCreator.mockResolvedValue({});

    const { getCreator } = await import("./creator");
    const result = await getCreator(
      {
        publicId: "CREATOR001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message: "Could not load the creators. Please try again later.",
      ok: false,
    });
  });
});

describe("listAllCreators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("follows the cursor to include the hundred-and-first entry onwards", async () => {
    mockListCreators
      .mockResolvedValueOnce({
        creators: creatorPage(100),
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        creators: [
          { name: "Zebra", profileText: "", publicId: "CREATOR101" },
          { name: "Alpha", profileText: "", publicId: "CREATOR102" },
        ],
        nextToken: "",
      });

    const { listAllCreators } = await import("./creator");
    const result = await listAllCreators("TENANT001", "en");

    expect(mockListCreators).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockListCreators).toHaveBeenNthCalledWith(
      2,
      {
        limit: 100,
        tenant: { tenantId: "TENANT001" },
        token: "page-2",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.creators).toHaveLength(102);
    expect(result.creators.at(0)?.publicId).toBe("CREATOR102");
    expect(result.creators.at(-1)?.publicId).toBe("CREATOR101");
    expect(
      result.creators.some((creator) => creator.publicId === "CREATOR101")
    ).toBe(true);
  });

  it("does not call the RPC when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const { listAllCreators } = await import("./creator");
    const result = await listAllCreators("TENANT001", "en");

    expect(mockListCreators).not.toHaveBeenCalled();
    expect(result).toEqual({
      creators: [],
      message: "Your session is no longer valid. Please sign in again.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    });
  });

  it("returns no partial result when nextToken repeats itself", async () => {
    mockListCreators
      .mockResolvedValueOnce({
        creators: creatorPage(100),
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        creators: [
          { name: "Partial", profileText: "", publicId: "CREATOR101" },
        ],
        nextToken: "page-2",
      });

    const { listAllCreators } = await import("./creator");
    const result = await listAllCreators("TENANT001", "en");

    expect(mockListCreators).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      creators: [],
      message: "Could not load the creators. Please try again later.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
  });
});
