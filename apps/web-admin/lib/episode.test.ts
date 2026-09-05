import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAccessToken,
  mockGetEpisode,
  mockListEpisodes,
  mockReorderEpisodes,
} = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockGetEpisode: vi.fn(),
  mockListEpisodes: vi.fn(),
  mockReorderEpisodes: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    series: {
      getEpisode: mockGetEpisode,
      listEpisodes: mockListEpisodes,
      reorderEpisodes: mockReorderEpisodes,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const episode = (publicId: string, orderIndex: number) => ({
  orderIndex,
  price: 0,
  publicId,
  publishedAt: "",
  scheduledAt: "",
  status: "draft",
  title: publicId,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("listEpisodes", () => {
  it("passes the cursor token and the limit through and returns the tokens of the response", async () => {
    mockListEpisodes.mockResolvedValue({
      episodes: [],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    const { listEpisodes } = await import("./episode");
    const result = await listEpisodes(
      {
        limit: 20,
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
        token: "current-page",
      },
      "en"
    );

    expect(mockListEpisodes).toHaveBeenCalledWith(
      {
        limit: 20,
        seriesPublicId: "SERIES001",
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

  it("fetches the first page with the default page size and an empty token", async () => {
    mockListEpisodes.mockResolvedValue({ episodes: [] });

    const { listEpisodes } = await import("./episode");
    const result = await listEpisodes(
      {
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockListEpisodes).toHaveBeenCalledWith(
      {
        limit: 20,
        seriesPublicId: "SERIES001",
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
    mockListEpisodes.mockResolvedValue({
      episodes: [episode("EPISODE003", 3), episode("EPISODE001", 1)],
    });

    const { listEpisodes } = await import("./episode");
    const result = await listEpisodes(
      {
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.episodes.map((item) => item.publicId)).toEqual([
      "EPISODE003",
      "EPISODE001",
    ]);
  });

  it("returns a result with no token when the fetch fails", async () => {
    mockListEpisodes.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listEpisodes } = await import("./episode");
    const result = await listEpisodes(
      {
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
        token: "current-page",
      },
      "en"
    );

    expect(result).toMatchObject({
      episodes: [],
      nextToken: "",
      ok: false,
      previousToken: "",
    });
  });
});

describe("listAllEpisodes", () => {
  it("follows the cursor past the hundredth entry and keeps the order of the server", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      episode(`EPISODE${String(index + 1).padStart(3, "0")}`, index + 1)
    );
    mockListEpisodes
      .mockResolvedValueOnce({
        episodes: firstPage,
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        episodes: [episode("EPISODE101", 101)],
        nextToken: "",
      });

    const { listAllEpisodes } = await import("./episode");
    const result = await listAllEpisodes(
      {
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockListEpisodes).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        seriesPublicId: "SERIES001",
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.episodes).toHaveLength(101);
    expect(result.episodes.at(0)?.publicId).toBe("EPISODE001");
    expect(result.episodes.at(-1)?.publicId).toBe("EPISODE101");
  });

  it("does not call the RPC when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listAllEpisodes } = await import("./episode");
    const result = await listAllEpisodes(
      {
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockListEpisodes).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      episodes: [],
      ok: false,
    });
  });

  it("returns no partial result when nextToken repeats itself", async () => {
    mockListEpisodes
      .mockResolvedValueOnce({
        episodes: [episode("EPISODE001", 1)],
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        episodes: [episode("EPISODE002", 2)],
        nextToken: "page-2",
      });

    const { listAllEpisodes } = await import("./episode");
    const result = await listAllEpisodes(
      {
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toMatchObject({
      episodes: [],
      ok: false,
    });
  });
});

describe("getEpisode", () => {
  it("calls the single-fetch RPC and returns the episode", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: episode("EPISODE001", 1),
    });

    const { getEpisode } = await import("./episode");
    const result = await getEpisode(
      {
        publicId: "EPISODE001",
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockGetEpisode).toHaveBeenCalledWith(
      {
        publicId: "EPISODE001",
        seriesPublicId: "SERIES001",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockListEpisodes).not.toHaveBeenCalled();
    expect(result).toEqual({
      episode: {
        orderIndex: 1,
        price: 0,
        publicId: "EPISODE001",
        publishedAt: "",
        readingPeriodHours: 0,
        scheduledAt: "",
        status: "draft",
        title: "EPISODE001",
      },
      ok: true,
    });
  });

  it("returns the scheduledAt of a scheduled episode untouched", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: {
        ...episode("EPISODE002", 2),
        scheduledAt: "2030-01-01T01:00:00Z",
        status: "scheduled",
      },
    });

    const { getEpisode } = await import("./episode");
    const result = await getEpisode(
      {
        publicId: "EPISODE002",
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toMatchObject({
      episode: { scheduledAt: "2030-01-01T01:00:00Z", status: "scheduled" },
      ok: true,
    });
  });

  it("returns notFound for a missing episode and for one outside the tenant", async () => {
    mockGetEpisode.mockRejectedValue(
      new ConnectError("episode not found", Code.NotFound)
    );

    const { getEpisode } = await import("./episode");
    const result = await getEpisode(
      {
        publicId: "EPISODE_MISSING",
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({ notFound: true, ok: false });
  });
});

describe("mergeEpisodeOrder", () => {
  it("writes the order within the page back to the same positions in the whole series", async () => {
    const { mergeEpisodeOrder } = await import("./episode");

    expect(
      mergeEpisodeOrder(["A", "B", "C", "D", "E"], ["C", "D"], ["D", "C"])
    ).toEqual(["A", "B", "D", "C", "E"]);
  });

  it("writes when the order within the page still holds even though an episode outside it is gone", async () => {
    const { mergeEpisodeOrder } = await import("./episode");

    expect(mergeEpisodeOrder(["A", "C", "D"], ["C", "D"], ["D", "C"])).toEqual([
      "A",
      "D",
      "C",
    ]);
  });

  it("gives up when the page no longer matches the series", async () => {
    const { mergeEpisodeOrder } = await import("./episode");

    // A page holding an episode that has already been deleted.
    expect(mergeEpisodeOrder(["A", "B"], ["B", "Z"], ["B", "Z"])).toBeNull();
    // A page that returned the same episode twice.
    expect(mergeEpisodeOrder(["A", "B"], ["A", "B"], ["B", "B"])).toBeNull();
    // A page whose row count does not match the one that was on screen.
    expect(mergeEpisodeOrder(["A", "B"], ["A"], ["B", "A"])).toBeNull();
  });

  it("does not write when another episode has slipped into the page", async () => {
    const { mergeEpisodeOrder } = await import("./episode");

    // The screen showed [C, D], and A and B then moved in between them. The ids
    // alone still line up, so pouring them into the slots would give
    // [D, A, B, C] and move rows the operator never touched.
    expect(
      mergeEpisodeOrder(["C", "A", "B", "D"], ["C", "D"], ["D", "C"])
    ).toBeNull();
  });

  it("does not write when the order on screen disagrees with the current one", async () => {
    const { mergeEpisodeOrder } = await import("./episode");

    // The screen showed [C, D], but another change had already swapped them to
    // [D, C].
    expect(
      mergeEpisodeOrder(["A", "B", "D", "C"], ["C", "D"], ["D", "C"])
    ).toBeNull();
  });
});

describe("reorderEpisodePage", () => {
  it("reads the whole series first and then sends every entry with the order of the page merged in", async () => {
    mockListEpisodes
      .mockResolvedValueOnce({
        episodes: [episode("EPISODE001", 1), episode("EPISODE002", 2)],
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        episodes: [episode("EPISODE003", 3), episode("EPISODE004", 4)],
        nextToken: "",
      });
    mockReorderEpisodes.mockResolvedValue({ episodes: [] });

    const { reorderEpisodePage } = await import("./episode");
    const result = await reorderEpisodePage(
      {
        currentEpisodePublicIds: ["EPISODE003", "EPISODE004"],
        episodePublicIds: ["EPISODE004", "EPISODE003"],
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(true);
    expect(mockReorderEpisodes).toHaveBeenCalledWith(
      {
        episodePublicIds: [
          "EPISODE001",
          "EPISODE002",
          "EPISODE004",
          "EPISODE003",
        ],
        expectedEpisodePublicIds: [
          "EPISODE001",
          "EPISODE002",
          "EPISODE003",
          "EPISODE004",
        ],
        seriesPublicId: "SERIES001",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("does not call the RPC when the order no longer matches", async () => {
    mockListEpisodes.mockResolvedValue({
      episodes: [episode("EPISODE001", 1)],
      nextToken: "",
    });

    const { reorderEpisodePage } = await import("./episode");
    const result = await reorderEpisodePage(
      {
        currentEpisodePublicIds: ["EPISODE002"],
        episodePublicIds: ["EPISODE002"],
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(false);
    expect(mockReorderEpisodes).not.toHaveBeenCalled();
  });

  it("does not call the RPC when another operation changed the order of the page meanwhile", async () => {
    // While the screen showed [EPISODE003, EPISODE004], EPISODE001 and
    // EPISODE002 moved in between them.
    mockListEpisodes.mockResolvedValue({
      episodes: [
        episode("EPISODE003", 1),
        episode("EPISODE001", 2),
        episode("EPISODE002", 3),
        episode("EPISODE004", 4),
      ],
      nextToken: "",
    });

    const { reorderEpisodePage } = await import("./episode");
    const result = await reorderEpisodePage(
      {
        currentEpisodePublicIds: ["EPISODE003", "EPISODE004"],
        episodePublicIds: ["EPISODE004", "EPISODE003"],
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(false);
    expect(mockReorderEpisodes).not.toHaveBeenCalled();
  });

  it("does not write and asks for a reload when the server reports an ordering conflict", async () => {
    mockListEpisodes.mockResolvedValue({
      episodes: [episode("EPISODE001", 1), episode("EPISODE002", 2)],
      nextToken: "",
    });
    mockReorderEpisodes.mockRejectedValue(
      new ConnectError("episode order has changed", Code.FailedPrecondition)
    );

    const { reorderEpisodePage } = await import("./episode");
    const result = await reorderEpisodePage(
      {
        currentEpisodePublicIds: ["EPISODE001", "EPISODE002"],
        episodePublicIds: ["EPISODE002", "EPISODE001"],
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      message:
        "The episode order could not be updated because another change altered the series. Reload the screen and try again.",
    });
  });

  it("does not call the RPC when reading the series fails", async () => {
    mockListEpisodes.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { reorderEpisodePage } = await import("./episode");
    const result = await reorderEpisodePage(
      {
        currentEpisodePublicIds: ["EPISODE001"],
        episodePublicIds: ["EPISODE001"],
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(false);
    expect(mockReorderEpisodes).not.toHaveBeenCalled();
  });
});
