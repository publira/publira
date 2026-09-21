import {
  CreatorCreditSource,
  ReadingDirection,
  SurfaceAvailability,
} from "@publira/api-client/admin/types";
import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockBulkEditEpisodeCredits,
  mockCreateEpisode,
  mockGetAccessToken,
  mockGetEpisode,
  mockListEpisodeCredits,
  mockListEpisodes,
  mockReorderEpisodes,
  mockUpdateEpisodeAvailability,
  mockUpdateEpisodeLayout,
  mockUpdateEpisodePurchaseAvailability,
} = vi.hoisted(() => ({
  mockBulkEditEpisodeCredits: vi.fn(),
  mockCreateEpisode: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetEpisode: vi.fn(),
  mockListEpisodeCredits: vi.fn(),
  mockListEpisodes: vi.fn(),
  mockReorderEpisodes: vi.fn(),
  mockUpdateEpisodeAvailability: vi.fn(),
  mockUpdateEpisodeLayout: vi.fn(),
  mockUpdateEpisodePurchaseAvailability: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    series: {
      bulkEditEpisodeCredits: mockBulkEditEpisodeCredits,
      createEpisode: mockCreateEpisode,
      getEpisode: mockGetEpisode,
      listEpisodeCredits: mockListEpisodeCredits,
      listEpisodes: mockListEpisodes,
      reorderEpisodes: mockReorderEpisodes,
      updateEpisodeAvailability: mockUpdateEpisodeAvailability,
      updateEpisodeLayout: mockUpdateEpisodeLayout,
      updateEpisodePurchaseAvailability: mockUpdateEpisodePurchaseAvailability,
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
        availability: "",
        orderIndex: 1,
        price: 0,
        publicId: "EPISODE001",
        publishedAt: "",
        readingPeriodHours: 0,
        scheduledAt: "",
        status: "draft",
        title: "EPISODE001",
      },
      layout: { readingDirection: "" },
      ok: true,
      purchaseAvailability: "",
    });
  });

  // The resolved layout rides on `episode`; the form reads the overrides beside
  // it, because following the series is a choice it offers.
  it("reads the episode's own overrides apart from the layout they resolve to", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: {
        ...episode("EPISODE001", 1),
        readingDirection: ReadingDirection.LEFT_TO_RIGHT,
        spreadStartIndex: 0,
      },
      readingDirection: ReadingDirection.LEFT_TO_RIGHT,
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

    expect(result).toMatchObject({
      layout: { readingDirection: "ltr", spreadStartIndex: undefined },
      ok: true,
    });
  });

  it("reports an override direction it cannot name", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: episode("EPISODE001", 1),
      readingDirection: 99,
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

    expect(result.ok).toBe(false);
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

describe("the surfaces an episode is shown on", () => {
  it("reads the episode's own value, and the empty value where it follows its series", async () => {
    mockListEpisodes.mockResolvedValue({
      episodes: [
        { ...episode("EPISODE001", 1), availability: SurfaceAvailability.APP },
        episode("EPISODE002", 2),
      ],
    });

    const { listEpisodes } = await import("./episode");
    const result = await listEpisodes(
      { seriesPublicId: "SERIES001", tenantId: "TENANT001" },
      "en"
    );

    expect(result.episodes.map((item) => item.availability)).toEqual([
      "app",
      "",
    ]);
  });

  // Opening the form on following the series for a value this build cannot
  // name would write that over the episode's own value on the next save.
  it("reports an episode value it cannot name", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: { ...episode("EPISODE001", 1), availability: 99 },
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

    expect(result.ok).toBe(false);
  });

  it("creates an episode that follows its series by sending nothing of its own", async () => {
    mockCreateEpisode.mockResolvedValue({ episode: episode("EPISODE001", 1) });

    const { createEpisode } = await import("./episode");
    await createEpisode(
      {
        availability: "",
        price: 0,
        publishAt: "",
        purchaseAvailability: "",
        readingPeriodHours: 0,
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
        title: "Episode title",
      },
      "en"
    );

    expect(mockCreateEpisode).toHaveBeenCalledWith(
      expect.objectContaining({ availability: undefined }),
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("creates an episode kept to the surfaces it names", async () => {
    mockCreateEpisode.mockResolvedValue({ episode: episode("EPISODE001", 1) });

    const { createEpisode } = await import("./episode");
    await createEpisode(
      {
        availability: "web",
        price: 0,
        publishAt: "",
        purchaseAvailability: "",
        readingPeriodHours: 0,
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
        title: "Episode title",
      },
      "en"
    );

    expect(mockCreateEpisode).toHaveBeenCalledWith(
      expect.objectContaining({ availability: SurfaceAvailability.WEB }),
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("sends the override and reads back what was stored", async () => {
    mockUpdateEpisodeAvailability.mockResolvedValue({
      episode: {
        ...episode("EPISODE001", 1),
        availability: SurfaceAvailability.APP,
      },
    });

    const { updateEpisodeAvailability } = await import("./episode");
    const result = await updateEpisodeAvailability(
      {
        availability: "app",
        episodePublicId: "EPISODE001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUpdateEpisodeAvailability).toHaveBeenCalledWith(
      {
        availability: SurfaceAvailability.APP,
        episodePublicId: "EPISODE001",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ availability: "app", ok: true });
  });

  // Unspecified is stored as no value, which is what keeps the episode
  // following its series after the series changes.
  it("sends unspecified to return the episode to its series", async () => {
    mockUpdateEpisodeAvailability.mockResolvedValue({
      episode: episode("EPISODE001", 1),
    });

    const { updateEpisodeAvailability } = await import("./episode");
    const result = await updateEpisodeAvailability(
      {
        availability: "",
        episodePublicId: "EPISODE001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUpdateEpisodeAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ availability: undefined }),
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ availability: "", ok: true });
  });
});

describe("where an episode may be bought", () => {
  it("reads the episode's own value apart from the one it resolves to", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: {
        ...episode("EPISODE001", 1),
        purchaseAvailability: SurfaceAvailability.WEB,
      },
      purchaseAvailability: SurfaceAvailability.APP,
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

    expect(result).toMatchObject({ ok: true, purchaseAvailability: "app" });
  });

  it("reads an episode that states nothing as following its series", async () => {
    mockGetEpisode.mockResolvedValue({ episode: episode("EPISODE001", 1) });

    const { getEpisode } = await import("./episode");
    const result = await getEpisode(
      {
        publicId: "EPISODE001",
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toMatchObject({ ok: true, purchaseAvailability: "" });
  });

  // Opening the form on following the series for a value this build cannot
  // name would write that over the episode's own value on the next save.
  it("reports a value it cannot name", async () => {
    mockGetEpisode.mockResolvedValue({
      episode: episode("EPISODE001", 1),
      purchaseAvailability: 99,
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

    expect(result.ok).toBe(false);
  });

  it("creates an episode sold where it names", async () => {
    mockCreateEpisode.mockResolvedValue({ episode: episode("EPISODE001", 1) });

    const { createEpisode } = await import("./episode");
    await createEpisode(
      {
        availability: "",
        price: 100,
        publishAt: "",
        purchaseAvailability: "app",
        readingPeriodHours: 0,
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
        title: "Episode title",
      },
      "en"
    );

    expect(mockCreateEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseAvailability: SurfaceAvailability.APP,
      }),
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("sends the override and reads back what was stored", async () => {
    mockUpdateEpisodePurchaseAvailability.mockResolvedValue({
      episode: episode("EPISODE001", 1),
      purchaseAvailability: SurfaceAvailability.WEB,
    });

    const { updateEpisodePurchaseAvailability } = await import("./episode");
    const result = await updateEpisodePurchaseAvailability(
      {
        episodePublicId: "EPISODE001",
        purchaseAvailability: "web",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUpdateEpisodePurchaseAvailability).toHaveBeenCalledWith(
      {
        episodePublicId: "EPISODE001",
        purchaseAvailability: SurfaceAvailability.WEB,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ ok: true, purchaseAvailability: "web" });
  });

  it("sends unspecified to return the episode to its series", async () => {
    mockUpdateEpisodePurchaseAvailability.mockResolvedValue({
      episode: episode("EPISODE001", 1),
      purchaseAvailability: SurfaceAvailability.UNSPECIFIED,
    });

    const { updateEpisodePurchaseAvailability } = await import("./episode");
    const result = await updateEpisodePurchaseAvailability(
      {
        episodePublicId: "EPISODE001",
        purchaseAvailability: "",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUpdateEpisodePurchaseAvailability).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseAvailability: SurfaceAvailability.UNSPECIFIED,
      }),
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ ok: true, purchaseAvailability: "" });
  });
});

describe("updateEpisodeLayout", () => {
  it("sends the overrides and reads back what was stored", async () => {
    mockUpdateEpisodeLayout.mockResolvedValue({
      episode: episode("EPISODE001", 1),
      readingDirection: ReadingDirection.LEFT_TO_RIGHT,
      spreadStartIndex: 0,
    });

    const { updateEpisodeLayout } = await import("./episode");
    const result = await updateEpisodeLayout(
      {
        episodePublicId: "EPISODE001",
        readingDirection: "ltr",
        spreadStartIndex: 0,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUpdateEpisodeLayout).toHaveBeenCalledWith(
      {
        episodePublicId: "EPISODE001",
        readingDirection: ReadingDirection.LEFT_TO_RIGHT,
        spreadStartIndex: 0,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      layout: { readingDirection: "ltr", spreadStartIndex: 0 },
      ok: true,
    });
  });

  // Unspecified and an absent index are stored as no value, which is what keeps
  // the episode following its series after the series changes.
  it("sends nothing of its own for an episode that follows its series", async () => {
    mockUpdateEpisodeLayout.mockResolvedValue({
      episode: episode("EPISODE001", 1),
      readingDirection: ReadingDirection.UNSPECIFIED,
    });

    const { updateEpisodeLayout } = await import("./episode");
    await updateEpisodeLayout(
      {
        episodePublicId: "EPISODE001",
        readingDirection: "",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUpdateEpisodeLayout).toHaveBeenCalledWith(
      {
        episodePublicId: "EPISODE001",
        readingDirection: undefined,
        spreadStartIndex: undefined,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("says the page is past the last one when the server refuses the index", async () => {
    mockUpdateEpisodeLayout.mockRejectedValue(
      new ConnectError(
        "spread_start_index must name one of the episode's pages",
        Code.InvalidArgument,
        undefined,
        [
          {
            desc: BadRequestSchema,
            value: { fieldViolations: [{ field: "spread_start_index" }] },
          },
        ]
      )
    );

    const { updateEpisodeLayout } = await import("./episode");
    const result = await updateEpisodeLayout(
      {
        episodePublicId: "EPISODE001",
        readingDirection: "",
        spreadStartIndex: 12,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "Spreads cannot start past the episode's last page. Choose one of its pages.",
      ok: false,
    });
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

describe("listEpisodeCredits", () => {
  it("reads each credit's share from the records beside the creators", async () => {
    mockListEpisodeCredits.mockResolvedValue({
      creatorCredits: [
        {
          creatorPublicId: "CREATOR_B",
          rolePublicId: "ROLE_ARTIST",
          shareBps: 3333,
        },
      ],
      creators: [
        {
          publicId: "CREATOR_B",
          role: { publicId: "ROLE_ARTIST" },
          source: CreatorCreditSource.SERIES,
        },
      ],
    });

    const { listEpisodeCredits } = await import("./episode");
    const result = await listEpisodeCredits(
      { episodePublicId: "EP01", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      credits: [
        {
          creatorPublicId: "CREATOR_B",
          rolePublicId: "ROLE_ARTIST",
          shareBps: 3333,
          source: CreatorCreditSource.SERIES,
        },
      ],
      ok: true,
    });
  });
});

describe("bulkEditEpisodeCredits", () => {
  it("sends the composed public ids and the replace operation", async () => {
    mockBulkEditEpisodeCredits.mockResolvedValue({
      changedEpisodePublicIds: ["EP01", "EP02"],
      unchangedEpisodes: [{ episodePublicId: "EP03", reason: 3 }],
    });

    const { bulkEditEpisodeCredits } = await import("./episode");
    const result = await bulkEditEpisodeCredits(
      {
        episodePublicIds: ["EP01", "EP02", "EP03"],
        operation: {
          from: { creatorPublicId: "CREATOR_B", rolePublicId: "ROLE_ARTIST" },
          to: { creatorPublicId: "CREATOR_C", rolePublicId: "ROLE_ARTIST" },
          type: "replace",
        },
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockBulkEditEpisodeCredits).toHaveBeenCalledWith(
      {
        episodePublicIds: ["EP01", "EP02", "EP03"],
        operation: {
          case: "replace",
          value: {
            from: { creatorPublicId: "CREATOR_B", rolePublicId: "ROLE_ARTIST" },
            to: { creatorPublicId: "CREATOR_C", rolePublicId: "ROLE_ARTIST" },
          },
        },
        seriesPublicId: "SERIES001",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      changedEpisodePublicIds: ["EP01", "EP02"],
      ok: true,
      unchangedEpisodes: [
        {
          episodePublicId: "EP03",
          reason: "credited_on_the_episode",
        },
      ],
    });
  });

  it("maps a duplicate-credit precondition to the selection-edit wording", async () => {
    mockBulkEditEpisodeCredits.mockRejectedValue(
      new ConnectError("already credited", Code.FailedPrecondition)
    );

    const { bulkEditEpisodeCredits } = await import("./episode");
    const result = await bulkEditEpisodeCredits(
      {
        episodePublicIds: ["EP01"],
        operation: {
          from: { creatorPublicId: "CREATOR_B", rolePublicId: "ROLE_ARTIST" },
          to: { creatorPublicId: "CREATOR_C", rolePublicId: "ROLE_ARTIST" },
          type: "replace",
        },
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "Some of the selected episodes already credit the author this would become. Change the replacement or the selection.",
      ok: false,
    });
  });

  it("sends a set-share with the share on the credit", async () => {
    mockBulkEditEpisodeCredits.mockResolvedValue({
      changedEpisodePublicIds: ["EP01"],
      unchangedEpisodes: [],
    });

    const { bulkEditEpisodeCredits } = await import("./episode");
    await bulkEditEpisodeCredits(
      {
        episodePublicIds: ["EP01"],
        operation: {
          credit: { creatorPublicId: "CREATOR_B", rolePublicId: "ROLE_ARTIST" },
          shareBps: 3333,
          type: "set_share",
        },
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockBulkEditEpisodeCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: {
          case: "setShare",
          value: {
            credit: {
              creatorPublicId: "CREATOR_B",
              rolePublicId: "ROLE_ARTIST",
              shareBps: 3333,
            },
          },
        },
      }),
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  // The other credits on the range are not on screen, so the server is what
  // finds an episode the new share would take over 100%.
  it("maps a refused set-share to the over-100% wording", async () => {
    mockBulkEditEpisodeCredits.mockRejectedValue(
      new ConnectError(
        "the share_bps total would exceed 10000",
        Code.InvalidArgument
      )
    );

    const { bulkEditEpisodeCredits } = await import("./episode");
    const result = await bulkEditEpisodeCredits(
      {
        episodePublicIds: ["EP01"],
        operation: {
          credit: { creatorPublicId: "CREATOR_B", rolePublicId: "ROLE_ARTIST" },
          shareBps: 6000,
          type: "set_share",
        },
        seriesPublicId: "SERIES001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "The new share would take some of the selected episodes over 100% in total. Lower the share or change the selection.",
      ok: false,
    });
  });
});
