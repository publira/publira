import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyAdminPageSession, mockVerifyAdminSession } = vi.hoisted(
  () => ({
    mockVerifyAdminPageSession: vi.fn(() =>
      Promise.resolve({ locale: "en" as const, tenantId: "TENANT001" })
    ),
    mockVerifyAdminSession: vi.fn(),
  })
);

vi.mock("./admin-page-session", () => ({
  verifyAdminPageSession: mockVerifyAdminPageSession,
}));

vi.mock("./auth-session", () => ({
  verifyAdminSession: mockVerifyAdminSession,
}));

const {
  mockCacheLife,
  mockCacheTag,
  mockDeleteCreator,
  mockGetAccessToken,
  mockGetCreator,
  mockLinkCreatorAccount,
  mockListCreatorCredits,
  mockListCreators,
  mockUnlinkCreatorAccount,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockDeleteCreator: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetCreator: vi.fn(),
  mockLinkCreatorAccount: vi.fn(),
  mockListCreatorCredits: vi.fn(),
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
      deleteCreator: mockDeleteCreator,
      getCreator: mockGetCreator,
      linkCreatorAccount: mockLinkCreatorAccount,
      listCreatorCredits: mockListCreatorCredits,
      listCreators: mockListCreators,
      unlinkCreatorAccount: mockUnlinkCreatorAccount,
    },
  },
  withServiceHeaders: () => ({
    headers: { Authorization: "Bearer service-token" },
  }),
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
    const result = await listCreators({ limit: 20, token: "current-page" });

    expect(mockListCreators).toHaveBeenCalledWith(
      {
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "current-page",
      },
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(result).toMatchObject({
      nextToken: "next-page",
      ok: true,
      previousToken: "previous-page",
    });
    expect(mockGetAccessToken).not.toHaveBeenCalled();
    expect(mockCacheTag).toHaveBeenCalledWith("creators-TENANT001");
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("fetches the first page with an empty token", async () => {
    mockListCreators.mockResolvedValue({ creators: [] });

    const { listCreators } = await import("./creator");
    const result = await listCreators({});

    expect(mockListCreators).toHaveBeenCalledWith(
      {
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer service-token" } }
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
    const result = await listCreators({});

    expect(result.creators.map((item) => item.publicId)).toEqual([
      "CREATOR002",
      "CREATOR001",
    ]);
  });

  it("returns a result with no token when the fetch fails", async () => {
    mockListCreators.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listCreators } = await import("./creator");
    const result = await listCreators({ token: "current-page" });

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
        iconImageFileSizeBytes: 0n,
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

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockGetCreator.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getCreator } = await import("./creator");

    await expect(
      getCreator({ publicId: "CREATOR001", tenantId: "TENANT001" }, "en")
    ).rejects.toThrow(Error);
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

describe("listCreatorCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads one page of the author's credits with the operator's session", async () => {
    mockListCreatorCredits.mockResolvedValue({
      credits: [],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    const { listCreatorCredits } = await import("./creator");

    const result = await listCreatorCredits(
      {
        creatorId: "CREATOR001-ID",
        tenantId: "TENANT001",
        token: "current-page",
      },
      "en"
    );

    // The service credential is not admitted on ListCreatorCredits.
    expect(mockListCreatorCredits).toHaveBeenCalledExactlyOnceWith(
      {
        creatorId: "CREATOR001-ID",
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "current-page",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      credits: [],
      nextToken: "next-page",
      ok: true,
      previousToken: "previous-page",
    });
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  // A credit changes with the series or the episode it is on, and a row shows
  // their titles and the role's name, so the read carries the tags their
  // writes clear rather than one of its own that nothing would clear.
  it("carries the tags of the series, the episodes, and the roles", async () => {
    mockListCreatorCredits.mockResolvedValue({ credits: [] });

    const { listCreatorCredits } = await import("./creator");

    await listCreatorCredits(
      { creatorId: "CREATOR001-ID", tenantId: "TENANT001" },
      "en"
    );

    expect(mockCacheTag).toHaveBeenCalledWith("creators-TENANT001");
    expect(mockCacheTag).toHaveBeenCalledWith("series-list-TENANT001");
    expect(mockCacheTag).toHaveBeenCalledWith("episodes-TENANT001");
    expect(mockCacheTag).toHaveBeenCalledWith("creator-roles-TENANT001");
  });

  it("keeps the server's order and tells a series credit from an episode's", async () => {
    mockListCreatorCredits.mockResolvedValue({
      credits: [
        {
          role: { id: "ROLE-WRITER", name: "Writer", publicId: "writer" },
          series: { id: "SERIES-B", publicId: "SERIESB", title: "Beta" },
        },
        {
          episode: { id: "EPISODE-1", publicId: "EPISODE1", title: "One" },
          series: { id: "SERIES-B", publicId: "SERIESB", title: "Beta" },
        },
        {
          episode: { id: "EPISODE-2", publicId: "EPISODE2", title: "Two" },
          role: { id: "ROLE-ARTIST", name: "Artist", publicId: "artist" },
          series: { id: "SERIES-A", publicId: "SERIESA", title: "Alpha" },
        },
        // A credit whose series the response left out has nowhere to link.
        {
          episode: { id: "EPISODE-3", publicId: "EPISODE3", title: "Three" },
        },
      ],
    });

    const { listCreatorCredits } = await import("./creator");

    const result = await listCreatorCredits(
      { creatorId: "CREATOR001-ID", tenantId: "TENANT001" },
      "en"
    );

    expect(result.credits).toEqual([
      {
        episode: undefined,
        roleId: "ROLE-WRITER",
        roleName: "Writer",
        series: { id: "SERIES-B", publicId: "SERIESB", title: "Beta" },
      },
      {
        episode: { id: "EPISODE-1", publicId: "EPISODE1", title: "One" },
        roleId: "",
        roleName: "",
        series: { id: "SERIES-B", publicId: "SERIESB", title: "Beta" },
      },
      {
        episode: { id: "EPISODE-2", publicId: "EPISODE2", title: "Two" },
        roleId: "ROLE-ARTIST",
        roleName: "Artist",
        series: { id: "SERIES-A", publicId: "SERIESA", title: "Alpha" },
      },
    ]);
  });

  it("returns an error without calling the RPC when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const { listCreatorCredits } = await import("./creator");

    const result = await listCreatorCredits(
      { creatorId: "CREATOR001-ID", tenantId: "TENANT001" },
      "en"
    );

    expect(mockListCreatorCredits).not.toHaveBeenCalled();
    expect(result).toEqual({
      credits: [],
      message: "Your session is no longer valid. Please sign in again.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    });
  });

  it("returns a message and drops the entry when the read fails", async () => {
    mockListCreatorCredits.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listCreatorCredits } = await import("./creator");

    const result = await listCreatorCredits(
      { creatorId: "CREATOR001-ID", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toMatchObject({
      credits: [],
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

  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockListCreatorCredits.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { listCreatorCredits } = await import("./creator");

    await expect(
      listCreatorCredits(
        { creatorId: "CREATOR001-ID", tenantId: "TENANT001" },
        "en"
      )
    ).rejects.toThrow(Error);
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
    const result = await listAllCreators();

    expect(mockListCreators).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(mockListCreators).toHaveBeenNthCalledWith(
      2,
      {
        limit: 100,
        tenant: { tenantId: "TENANT001" },
        token: "page-2",
      },
      { headers: { Authorization: "Bearer service-token" } }
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
    expect(mockGetAccessToken).not.toHaveBeenCalled();
    expect(mockCacheTag).toHaveBeenCalledWith("creators-TENANT001");
    expect(mockCacheLife).not.toHaveBeenCalled();
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
    const result = await listAllCreators();

    expect(mockListCreators).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      creators: [],
      message: "Could not load the authors. Please try again later.",
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

  it("returns no partial result and drops the cache entry when the fetch fails", async () => {
    mockListCreators.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listAllCreators } = await import("./creator");
    const result = await listAllCreators();

    expect(result).toMatchObject({ creators: [], ok: false });
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

describe("the operator check before a shared read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it.each([
    [
      "listCreators",
      async () => {
        const { listCreators } = await import("./creator");

        return await listCreators();
      },
      mockListCreators,
    ],
    [
      "listAllCreators",
      async () => {
        const { listAllCreators } = await import("./creator");

        return await listAllCreators();
      },
      mockListCreators,
    ],
  ] as const)(
    "%s confirms the operator of the screen's tenant before reading anything",
    async (_, read, rpc) => {
      const redirect = new Error("NEXT_REDIRECT");
      mockVerifyAdminPageSession.mockRejectedValueOnce(redirect);

      await expect(read()).rejects.toBe(redirect);
      expect(rpc).not.toHaveBeenCalled();
    }
  );
});

const creatorReferencedError = (reason: string) =>
  new ConnectError(
    "creator is referenced",
    Code.FailedPrecondition,
    undefined,
    [{ desc: ErrorInfoSchema, value: { domain: "publira", reason } }]
  );

describe("deleteCreator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("deletes the author with the operator's session", async () => {
    mockDeleteCreator.mockResolvedValue({});

    const { deleteCreator } = await import("./creator");

    const result = await deleteCreator(
      { id: "CREATOR001-ID", tenantId: "TENANT001" },
      "en"
    );

    expect(mockDeleteCreator).toHaveBeenCalledWith(
      { creatorId: "CREATOR001-ID", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ ok: true });
  });

  it.each([
    {
      message:
        "This author cannot be deleted while a series or an episode credits them. Remove them from the Authors of each series and episode listed under Credits on this page first.",
      reason: "CREATOR_CREDITED",
      reference: "credits",
    },
    {
      message:
        "This author cannot be deleted: a closed royalty statement has a line for them, and a statement is kept as it was closed.",
      reason: "CREATOR_ON_ROYALTY_STATEMENT",
      reference: undefined,
    },
    {
      message:
        "This author cannot be deleted while a reader account is linked to them. Unlink each account under Reader accounts on this page first.",
      reason: "CREATOR_HAS_LINKED_ACCOUNT",
      reference: undefined,
    },
  ])(
    "words $reason as what refers to the author",
    async ({ message, reason, reference }) => {
      mockDeleteCreator.mockRejectedValue(creatorReferencedError(reason));

      const { deleteCreator } = await import("./creator");

      const result = await deleteCreator(
        { id: "CREATOR001-ID", tenantId: "TENANT001" },
        "en"
      );

      expect(result).toEqual({ message, ok: false, reference });
    }
  );

  // A server newer than this console may refuse for a reason it has no
  // sentence for yet, which is still a refusal rather than a failure.
  it("words a refusal for a reason it does not know as a refusal", async () => {
    mockDeleteCreator.mockRejectedValue(
      creatorReferencedError("CREATOR_SOMETHING_NEW")
    );

    const { deleteCreator } = await import("./creator");

    const result = await deleteCreator(
      { id: "CREATOR001-ID", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      message:
        "This author cannot be deleted: a record that has to be kept refers to them.",
      ok: false,
    });
  });

  it("says an author deleted already is gone", async () => {
    mockDeleteCreator.mockRejectedValue(
      new ConnectError("creator not found", Code.NotFound)
    );

    const { deleteCreator } = await import("./creator");

    const result = await deleteCreator(
      { id: "CREATOR001-ID", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      message:
        "This author has already been deleted. Go back to the author list.",
      ok: false,
    });
  });
});
