import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetCreator,
  mockLinkCreatorAccount,
  mockListCreators,
  mockUnlinkCreatorAccount,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetCreator: vi.fn(),
  mockLinkCreatorAccount: vi.fn(),
  mockListCreators: vi.fn(),
  mockUnlinkCreatorAccount: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    creator: {
      getCreator: mockGetCreator,
      linkCreatorAccount: mockLinkCreatorAccount,
      listCreators: mockListCreators,
      unlinkCreatorAccount: mockUnlinkCreatorAccount,
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
    expect(mockCacheLife).not.toHaveBeenCalled();
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
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("asks for a fresh login and drops the cache entry when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listCreators } = await import("./creator");
    const result = await listCreators("TENANT001", "en", {});

    expect(mockListCreators).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      creators: [],
      ok: false,
      requiresSignIn: true,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
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
      accounts: [],
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
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("carries the reader accounts linked to the creator", async () => {
    mockGetCreator.mockResolvedValue({
      accounts: [
        {
          linkedAt: "2026-09-01T00:00:00Z",
          reader: {
            createdAt: "2026-01-01T00:00:00Z",
            email: "one@example.com",
            id: "018f0e6a-5000-7000-8000-000000000001",
            name: "Reader One",
            publicId: "READER001",
            status: "active",
          },
        },
        // A link whose account the response left out has nothing to show.
        { linkedAt: "2026-09-02T00:00:00Z" },
      ],
      creator: { name: "Target", profileText: "", publicId: "CREATOR101" },
    });

    const { getCreator } = await import("./creator");
    const result = await getCreator(
      { publicId: "CREATOR101", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toMatchObject({
      accounts: [
        {
          createdAt: "2026-01-01T00:00:00Z",
          email: "one@example.com",
          id: "018f0e6a-5000-7000-8000-000000000001",
          linkedAt: "2026-09-01T00:00:00Z",
          name: "Reader One",
          publicId: "READER001",
          status: "active",
        },
      ],
      ok: true,
    });
    expect(result.ok && result.accounts).toHaveLength(1);
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
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
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
    // A missing creator is an answer, so the entry stays cacheable.
    expect(mockCacheLife).not.toHaveBeenCalled();
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
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
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
      message: "Could not load the authors. Please try again later.",
      ok: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
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
    expect(mockCacheLife).not.toHaveBeenCalled();
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
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
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
      message: "Could not load the authors. Please try again later.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("returns no partial result and drops the cache entry when the fetch fails", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockListCreators.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listAllCreators } = await import("./creator");
    const result = await listAllCreators("TENANT001", "en");

    expect(result).toMatchObject({
      creators: [],
      ok: false,
      requiresSignIn: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("linkCreatorAccount", () => {
  const input = {
    creatorId: "018f0e6a-2000-7000-8000-000000000001",
    readerId: "018f0e6a-5000-7000-8000-000000000001",
    tenantId: "TENANT001",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("links the account by both primary keys and returns the links after it", async () => {
    mockLinkCreatorAccount.mockResolvedValue({
      accounts: [
        {
          linkedAt: "2026-09-01T00:00:00Z",
          reader: {
            email: "one@example.com",
            id: input.readerId,
            name: "Reader One",
            publicId: "READER001",
            status: "active",
          },
        },
      ],
    });

    const { linkCreatorAccount } = await import("./creator");
    const result = await linkCreatorAccount(input, "en");

    expect(mockLinkCreatorAccount).toHaveBeenCalledWith(
      {
        creatorId: input.creatorId,
        readerId: input.readerId,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({
      accounts: [{ id: input.readerId, linkedAt: "2026-09-01T00:00:00Z" }],
      ok: true,
    });
  });

  it("says which readers can be linked when the API refuses an inactive one", async () => {
    const { Code, ConnectError } = await import("@publira/api-client/errors");
    mockLinkCreatorAccount.mockRejectedValue(
      new ConnectError("reader is not active", Code.FailedPrecondition)
    );

    const { linkCreatorAccount } = await import("./creator");
    const result = await linkCreatorAccount(input, "en");

    expect(result).toEqual({
      message:
        "Only an active reader who has confirmed their email address can be linked.",
      ok: false,
    });
  });
});

describe("unlinkCreatorAccount", () => {
  const input = {
    creatorId: "018f0e6a-2000-7000-8000-000000000001",
    readerId: "018f0e6a-5000-7000-8000-000000000001",
    tenantId: "TENANT001",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("unlinks the account by both primary keys and returns the links left", async () => {
    mockUnlinkCreatorAccount.mockResolvedValue({ accounts: [] });

    const { unlinkCreatorAccount } = await import("./creator");
    const result = await unlinkCreatorAccount(input, "en");

    expect(mockUnlinkCreatorAccount).toHaveBeenCalledWith(
      {
        creatorId: input.creatorId,
        readerId: input.readerId,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ accounts: [], ok: true });
  });

  it("returns an error without calling the RPC when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const { unlinkCreatorAccount } = await import("./creator");
    const result = await unlinkCreatorAccount(input, "en");

    expect(mockUnlinkCreatorAccount).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
    });
  });
});
