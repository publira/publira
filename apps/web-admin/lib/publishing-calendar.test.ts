import { Code, ConnectError } from "@publira/api-client/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyAdminPageSession } = vi.hoisted(() => ({
  mockVerifyAdminPageSession: vi.fn(() =>
    Promise.resolve({ locale: "en" as const, tenantId: "TENANT001" })
  ),
}));

vi.mock("./admin-page-session", () => ({
  verifyAdminPageSession: mockVerifyAdminPageSession,
}));

const { mockCacheLife, mockCacheTag, mockListEpisodesByPublicationDate } =
  vi.hoisted(() => ({
    mockCacheLife: vi.fn(),
    mockCacheTag: vi.fn(),
    mockListEpisodesByPublicationDate: vi.fn(),
  }));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({
    series: {
      listEpisodesByPublicationDate: mockListEpisodesByPublicationDate,
    },
  }),
}));

const PERIOD = { endDate: "2026-10-31", startDate: "2026-10-01" };

describe("listEpisodePublications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubEnv("PUBLIRA_WEB_SERVICE_TOKEN", "service-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads every page of the period with the service credential", async () => {
    mockListEpisodesByPublicationDate
      .mockResolvedValueOnce({
        episodes: [
          {
            episodePublicId: "EP001",
            episodeTitle: "Episode 1",
            publishedAt: "2026-10-01T10:00:00Z",
            seriesPublicId: "SR001",
            seriesTitle: "Series 1",
            status: "published",
          },
        ],
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        episodes: [
          {
            episodePublicId: "EP002",
            episodeTitle: "Episode 2",
            publishedAt: "2026-10-20T10:00:00Z",
            seriesPublicId: "SR002",
            seriesTitle: "Series 2",
            status: "scheduled",
          },
        ],
        nextToken: "",
      });

    const { listEpisodePublications } = await import("./publishing-calendar");

    const result = await listEpisodePublications(PERIOD);

    expect(result).toEqual({
      episodes: [
        {
          episodePublicId: "EP001",
          episodeTitle: "Episode 1",
          publishedAt: "2026-10-01T10:00:00Z",
          seriesPublicId: "SR001",
          seriesTitle: "Series 1",
          status: "published",
        },
        {
          episodePublicId: "EP002",
          episodeTitle: "Episode 2",
          publishedAt: "2026-10-20T10:00:00Z",
          seriesPublicId: "SR002",
          seriesTitle: "Series 2",
          status: "scheduled",
        },
      ],
      ok: true,
    });
    expect(mockListEpisodesByPublicationDate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        endDate: "2026-10-31",
        startDate: "2026-10-01",
        tenant: { tenantId: "TENANT001" },
        token: "",
      }),
      expect.objectContaining({
        headers: { Authorization: "Bearer service-token" },
      })
    );
    expect(mockListEpisodesByPublicationDate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ token: "page-2" }),
      expect.anything()
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("files the answer under the tags of the records it reports", async () => {
    mockListEpisodesByPublicationDate.mockResolvedValueOnce({
      episodes: [],
      nextToken: "",
    });

    const { listEpisodePublications } = await import("./publishing-calendar");
    const { tenantDashboardCacheTag } = await import("./dashboard");

    await listEpisodePublications(PERIOD);

    expect(mockCacheTag).toHaveBeenCalledWith(
      tenantDashboardCacheTag("TENANT001")
    );
    expect(mockCacheTag).toHaveBeenCalledWith("episodes-TENANT001");
    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT001:series:detail");
  });

  it("returns the shared wording for an unreachable server and caches nothing", async () => {
    mockListEpisodesByPublicationDate.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listEpisodePublications } = await import("./publishing-calendar");

    const result = await listEpisodePublications(PERIOD);

    expect(result).toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a walk that never ends instead of a calendar missing its later days", async () => {
    mockListEpisodesByPublicationDate.mockResolvedValue({
      episodes: [],
      nextToken: "same-token",
    });

    const { listEpisodePublications } = await import("./publishing-calendar");

    const result = await listEpisodePublications(PERIOD);

    expect(result).toEqual({
      message: "Could not load the calendar. Please try again later.",
      ok: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});
