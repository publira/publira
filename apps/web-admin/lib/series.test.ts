import {
  CommentMode,
  SeriesAgeRating,
  SeriesStatus,
} from "@publira/api-client/admin/types";
import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockGetAccessToken,
  mockGetSeries,
  mockListSeries,
  mockUpdateSeries,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetSeries: vi.fn(),
  mockListSeries: vi.fn(),
  mockUpdateSeries: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    series: {
      getSeries: mockGetSeries,
      listSeries: mockListSeries,
      updateSeries: mockUpdateSeries,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("listSeries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("passes the cursor token and the limit through and returns the tokens of the response", async () => {
    mockListSeries.mockResolvedValue({
      defaultReadingPeriodHours: 72,
      nextToken: "next-page",
      previousToken: "previous-page",
      series: [],
    });

    const { listSeries } = await import("./series");
    const result = await listSeries("TENANT001", "en", {
      limit: 20,
      token: "current-page",
    });

    expect(mockListSeries).toHaveBeenCalledWith(
      {
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "current-page",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({
      defaultReadingPeriodHours: 72,
      nextToken: "next-page",
      ok: true,
      previousToken: "previous-page",
    });
  });

  it("fetches the first page with an empty token", async () => {
    mockListSeries.mockResolvedValue({ series: [] });

    const { listSeries } = await import("./series");
    const result = await listSeries("TENANT001", "en", {});

    expect(mockListSeries).toHaveBeenCalledWith(
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

  it("sends selected classification filters as API enums", async () => {
    mockListSeries.mockResolvedValue({ series: [] });

    const { listSeries } = await import("./series");
    await listSeries("TENANT001", "en", {
      ageRating: "r15",
      status: "completed",
    });

    expect(mockListSeries).toHaveBeenCalledWith(
      {
        ageRating: SeriesAgeRating.R15,
        limit: 20,
        status: SeriesStatus.COMPLETED,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("returns the keyset order of the server without re-sorting it", async () => {
    mockListSeries.mockResolvedValue({
      series: [
        { creators: [], publicId: "SERIES002", synopsis: "", title: "Zulu" },
        { creators: [], publicId: "SERIES001", synopsis: "", title: "Alpha" },
      ],
    });

    const { listSeries } = await import("./series");
    const result = await listSeries("TENANT001", "en", {});

    expect(result.series.map((item) => item.publicId)).toEqual([
      "SERIES002",
      "SERIES001",
    ]);
  });

  it("returns a result with no token when the fetch fails", async () => {
    mockListSeries.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listSeries } = await import("./series");
    const result = await listSeries("TENANT001", "en", {
      token: "current-page",
    });

    expect(result).toMatchObject({
      nextToken: "",
      ok: false,
      previousToken: "",
      series: [],
    });
  });

  it("files the page under the tenant series list tag", async () => {
    mockListSeries.mockResolvedValue({ series: [] });

    const { listSeries, seriesListCacheTag } = await import("./series");
    await listSeries("TENANT001", "en", {});

    expect(mockCacheTag).toHaveBeenCalledWith(seriesListCacheTag("TENANT001"));
  });
});

describe("listAllSeries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("follows the cursor past the hundredth entry and returns them in title order", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      creators: [],
      publicId: `SERIES${String(index + 1).padStart(3, "0")}`,
      synopsis: "",
      title: `Series ${String(index + 1).padStart(3, "0")}`,
    }));
    mockListSeries
      .mockResolvedValueOnce({
        nextToken: "page-2",
        series: firstPage,
      })
      .mockResolvedValueOnce({
        nextToken: "",
        series: [
          { creators: [], publicId: "SERIES101", synopsis: "", title: "Zulu" },
          { creators: [], publicId: "SERIES102", synopsis: "", title: "Alpha" },
        ],
      });

    const { listAllSeries } = await import("./series");
    const result = await listAllSeries("TENANT001", "en");

    expect(mockListSeries).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.series).toHaveLength(102);
    expect(result.series.some((item) => item.publicId === "SERIES101")).toBe(
      true
    );
    const aIndex = result.series.findIndex(
      (item) => item.publicId === "SERIES102"
    );
    const nuIndex = result.series.findIndex(
      (item) => item.publicId === "SERIES101"
    );
    expect(aIndex).toBeGreaterThanOrEqual(0);
    expect(nuIndex).toBeGreaterThan(aIndex);
  });

  it("does not call the RPC when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listAllSeries } = await import("./series");
    const result = await listAllSeries("TENANT001", "en");

    expect(mockListSeries).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      series: [],
    });
  });

  it("returns no partial result when nextToken repeats itself", async () => {
    mockListSeries
      .mockResolvedValueOnce({
        nextToken: "page-2",
        series: [
          { creators: [], publicId: "SERIES001", synopsis: "", title: "A" },
        ],
      })
      .mockResolvedValueOnce({
        nextToken: "page-2",
        series: [
          { creators: [], publicId: "SERIES002", synopsis: "", title: "B" },
        ],
      });

    const { listAllSeries } = await import("./series");
    const result = await listAllSeries("TENANT001", "en");

    expect(result).toMatchObject({
      ok: false,
      series: [],
    });
  });

  it("files the picker options under the tenant series list tag", async () => {
    mockListSeries.mockResolvedValue({ nextToken: "", series: [] });

    const { listAllSeries, seriesListCacheTag } = await import("./series");
    await listAllSeries("TENANT001", "en");

    expect(mockCacheTag).toHaveBeenCalledWith(seriesListCacheTag("TENANT001"));
  });
});

describe("the classification a series carries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads the stored enums back as the values the form posts", async () => {
    mockListSeries.mockResolvedValue({
      series: [
        {
          ageRating: SeriesAgeRating.R18,
          genres: [
            { name: "Fantasy", publicId: "GENRE001", slug: "fantasy" },
            { name: "", publicId: "", slug: "" },
          ],
          publicId: "SERIES001",
          scheduleWeekdays: [1, 4],
          status: SeriesStatus.HIATUS,
          synopsis: "A synopsis",
          tags: [
            { name: "seaside", slug: "seaside" },
            { name: " ", slug: "" },
          ],
          title: "Series title",
        },
      ],
    });

    const { listSeries } = await import("./series");
    const result = await listSeries("TENANT001", "en");

    expect(result.series[0]).toMatchObject({
      ageRating: "r18",
      genrePublicIds: ["GENRE001"],
      scheduleWeekdays: [1, 4],
      status: "hiatus",
      tagNames: ["seaside"],
    });
  });

  // Unspecified is the column default rather than a missing value, so the form
  // opens on the same state a save that named no status would have written.
  it("reads an unspecified status and rating back as the column defaults", async () => {
    mockListSeries.mockResolvedValue({
      series: [
        {
          ageRating: SeriesAgeRating.UNSPECIFIED,
          publicId: "SERIES001",
          status: SeriesStatus.UNSPECIFIED,
          synopsis: "A synopsis",
          title: "Series title",
        },
      ],
    });

    const { listSeries } = await import("./series");
    const result = await listSeries("TENANT001", "en");

    expect(result.series[0]).toMatchObject({
      ageRating: "all",
      genrePublicIds: [],
      scheduleWeekdays: [],
      status: "ongoing",
      tagNames: [],
    });
  });

  // `UpdateSeries` writes the whole listing row, so every save has to carry the
  // classification back or it resets to the column defaults.
  it("sends the classification on every update", async () => {
    mockUpdateSeries.mockResolvedValue({
      series: { publicId: "SERIES001", synopsis: "", title: "" },
    });

    const { updateSeries } = await import("./series");
    await updateSeries(
      {
        ageRating: "r15",
        commentMode: "",
        creatorPublicIds: [],
        genrePublicIds: ["GENRE001"],
        isPublished: true,
        labelPublicId: "LABEL001",
        publicId: "SERIES001",
        readingPeriodHours: 24,
        scheduleWeekdays: [2],
        status: "completed",
        synopsis: "A synopsis",
        tagNames: ["seaside"],
        tenantId: "TENANT001",
        title: "Series title",
      },
      "en"
    );

    expect(mockUpdateSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        ageRating: SeriesAgeRating.R15,
        genrePublicIds: ["GENRE001"],
        scheduleWeekdays: [2],
        status: SeriesStatus.COMPLETED,
        tagNames: ["seaside"],
      }),
      { headers: { Authorization: "Bearer session-token" } }
    );
  });
});

/**
 * `series_listings.comment_mode` is the mode one series publishes comments
 * under instead of its tenant's, and NULL — `COMMENT_MODE_UNSPECIFIED` over
 * the wire — is the series stating none and following the tenant.
 */
describe("the comment mode a series states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads the series' own mode back beside the series", async () => {
    mockGetSeries.mockResolvedValue({
      commentMode: CommentMode.APPROVAL_REQUIRED,
      series: { publicId: "SERIES001", synopsis: "", title: "Series title" },
    });

    const { getSeries } = await import("./series");
    const result = await getSeries(
      { publicId: "SERIES001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toMatchObject({
      commentMode: "approval_required",
      ok: true,
    });
  });

  // The form offers "follow the tenant" as one of its options, so unspecified
  // has to arrive as that choice rather than as a mode of the series' own.
  it("reads an unspecified mode back as following the tenant", async () => {
    mockGetSeries.mockResolvedValue({
      commentMode: CommentMode.UNSPECIFIED,
      series: { publicId: "SERIES001", synopsis: "", title: "Series title" },
    });

    const { getSeries } = await import("./series");
    const result = await getSeries(
      { publicId: "SERIES001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toMatchObject({ commentMode: "", ok: true });
  });

  // Reporting a mode this build cannot name as "follows the tenant" would open
  // the form on that option, and the next save would write it over the mode the
  // series actually holds.
  it("reports a mode it cannot name rather than answering with the tenant's", async () => {
    mockGetSeries.mockResolvedValue({
      commentMode: 99,
      series: { publicId: "SERIES001", synopsis: "", title: "Series title" },
    });

    const { getSeries } = await import("./series");
    const result = await getSeries(
      { publicId: "SERIES001", tenantId: "TENANT001" },
      "en"
    );

    expect(result.ok).toBe(false);
  });

  // `UpdateSeries` writes the whole listing row, so a save that left the mode
  // out would put the series back on its tenant's setting.
  it("sends the mode on every update", async () => {
    mockUpdateSeries.mockResolvedValue({
      series: { publicId: "SERIES001", synopsis: "", title: "" },
    });

    const { updateSeries } = await import("./series");
    await updateSeries(
      {
        ageRating: "all",
        commentMode: "disabled",
        creatorPublicIds: [],
        genrePublicIds: [],
        isPublished: true,
        labelPublicId: "LABEL001",
        publicId: "SERIES001",
        readingPeriodHours: 24,
        scheduleWeekdays: [],
        status: "ongoing",
        synopsis: "A synopsis",
        tagNames: [],
        tenantId: "TENANT001",
        title: "Series title",
      },
      "en"
    );

    expect(mockUpdateSeries).toHaveBeenCalledWith(
      expect.objectContaining({ commentMode: CommentMode.DISABLED }),
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("sends unspecified for a series that states no mode of its own", async () => {
    mockUpdateSeries.mockResolvedValue({
      series: { publicId: "SERIES001", synopsis: "", title: "" },
    });

    const { updateSeries } = await import("./series");
    await updateSeries(
      {
        ageRating: "all",
        commentMode: "",
        creatorPublicIds: [],
        genrePublicIds: [],
        isPublished: true,
        labelPublicId: "LABEL001",
        publicId: "SERIES001",
        readingPeriodHours: 24,
        scheduleWeekdays: [],
        status: "ongoing",
        synopsis: "A synopsis",
        tagNames: [],
        tenantId: "TENANT001",
        title: "Series title",
      },
      "en"
    );

    expect(mockUpdateSeries).toHaveBeenCalledWith(
      expect.objectContaining({ commentMode: CommentMode.UNSPECIFIED }),
      { headers: { Authorization: "Bearer session-token" } }
    );
  });
});
