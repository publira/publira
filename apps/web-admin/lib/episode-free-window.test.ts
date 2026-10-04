import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyAdminPageSession } = vi.hoisted(() => ({
  mockVerifyAdminPageSession: vi.fn(() =>
    Promise.resolve({ locale: "en" as const, tenantId: "TENANT001" })
  ),
}));

vi.mock("./admin-page-session", () => ({
  verifyAdminPageSession: mockVerifyAdminPageSession,
}));

const {
  mockCacheLife,
  mockCacheTag,
  mockCreateEpisodeFreeWindow,
  mockCreateSeriesFreeWindows,
  mockDeleteEpisodeFreeWindow,
  mockGetAccessToken,
  mockListEpisodeFreeWindows,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockCreateEpisodeFreeWindow: vi.fn(),
  mockCreateSeriesFreeWindows: vi.fn(),
  mockDeleteEpisodeFreeWindow: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockListEpisodeFreeWindows: vi.fn(),
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
    series: {
      createEpisodeFreeWindow: mockCreateEpisodeFreeWindow,
      createSeriesFreeWindows: mockCreateSeriesFreeWindows,
      deleteEpisodeFreeWindow: mockDeleteEpisodeFreeWindow,
      listEpisodeFreeWindows: mockListEpisodeFreeWindows,
    },
  },
  withServiceHeaders: () => ({
    headers: { Authorization: "Bearer service-token" },
  }),
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const freeWindow = (id: string, startsAt: string, endsAt: string) => ({
  createdAt: "2026-10-01T00:00:00Z",
  endsAt,
  episodeId: "EPISODE-ID",
  episodePublicId: "EPISODE001",
  episodeTitle: "Chapter One",
  id,
  publicId: `${id}-PUBLIC`,
  seriesId: "SERIES-ID",
  seriesPublicId: "SERIES001",
  startsAt,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("listEpisodeFreeWindows", () => {
  it("reads every page of one episode's windows with the service credential", async () => {
    mockListEpisodeFreeWindows
      .mockResolvedValueOnce({
        freeWindows: [
          freeWindow("WINDOW2", "2026-10-10T00:00:00Z", "2026-10-11T00:00:00Z"),
        ],
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        freeWindows: [
          freeWindow("WINDOW1", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"),
        ],
        nextToken: "",
      });

    const { listEpisodeFreeWindows } = await import("./episode-free-window");
    const result = await listEpisodeFreeWindows({ episodeId: "EPISODE-ID" });

    expect(mockListEpisodeFreeWindows).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        scope: { case: "episodeId", value: "EPISODE-ID" },
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("episode-free-windows-TENANT001");
    expect(mockCacheTag).toHaveBeenCalledWith("episodes-TENANT001");
    // Written through the Admin API without this app, a window reaches the
    // list once the entry is a minute old.
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
    expect(result).toEqual({
      freeWindows: [
        {
          endsAt: "2026-10-11T00:00:00Z",
          episodeId: "EPISODE-ID",
          episodePublicId: "EPISODE001",
          episodeTitle: "Chapter One",
          id: "WINDOW2",
          startsAt: "2026-10-10T00:00:00Z",
        },
        {
          endsAt: "2026-10-02T00:00:00Z",
          episodeId: "EPISODE-ID",
          episodePublicId: "EPISODE001",
          episodeTitle: "Chapter One",
          id: "WINDOW1",
          startsAt: "2026-10-01T00:00:00Z",
        },
      ],
      ok: true,
    });
  });

  it("reports a failed read instead of an empty list", async () => {
    mockListEpisodeFreeWindows.mockRejectedValue(
      new ConnectError("down", Code.Unavailable)
    );

    const { listEpisodeFreeWindows } = await import("./episode-free-window");
    const result = await listEpisodeFreeWindows({ episodeId: "EPISODE-ID" });

    expect(result.ok).toBe(false);
  });
});

describe("createEpisodeFreeWindow", () => {
  it("sends the period with the operator's session", async () => {
    mockCreateEpisodeFreeWindow.mockResolvedValue({
      freeWindow: freeWindow(
        "WINDOW1",
        "2026-10-10T00:00:00Z",
        "2026-10-11T00:00:00Z"
      ),
    });

    const { createEpisodeFreeWindow } = await import("./episode-free-window");
    const result = await createEpisodeFreeWindow(
      {
        endsAt: "2026-10-11T00:00:00Z",
        episodeId: "EPISODE-ID",
        startsAt: "2026-10-10T00:00:00Z",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockCreateEpisodeFreeWindow).toHaveBeenCalledWith(
      {
        endsAt: "2026-10-11T00:00:00Z",
        episodeId: "EPISODE-ID",
        startsAt: "2026-10-10T00:00:00Z",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({ freeWindow: { id: "WINDOW1" }, ok: true });
  });

  it("words an overlap as one the editor can fix by choosing another period", async () => {
    mockCreateEpisodeFreeWindow.mockRejectedValue(
      new ConnectError("overlap", Code.FailedPrecondition)
    );

    const { createEpisodeFreeWindow } = await import("./episode-free-window");
    const result = await createEpisodeFreeWindow(
      {
        endsAt: "2026-10-11T00:00:00Z",
        episodeId: "EPISODE-ID",
        startsAt: "2026-10-10T00:00:00Z",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "The period overlaps a free reading period that is already scheduled. Choose another period or delete the existing one.",
      ok: false,
    });
  });
});

describe("createSeriesFreeWindows", () => {
  it("names the chosen episodes, and none for the whole series", async () => {
    mockCreateSeriesFreeWindows.mockResolvedValue({ freeWindows: [] });

    const { createSeriesFreeWindows } = await import("./episode-free-window");
    await createSeriesFreeWindows(
      {
        endsAt: "2026-10-11T00:00:00Z",
        episodeIds: ["EP1", "EP2"],
        seriesId: "SERIES-ID",
        startsAt: "2026-10-10T00:00:00Z",
        tenantId: "TENANT001",
      },
      "en"
    );
    await createSeriesFreeWindows(
      {
        endsAt: "2026-10-11T00:00:00Z",
        seriesId: "SERIES-ID",
        startsAt: "2026-10-10T00:00:00Z",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockCreateSeriesFreeWindows.mock.calls.map(([req]) => req)).toEqual([
      expect.objectContaining({ episodeIds: ["EP1", "EP2"] }),
      expect.objectContaining({ episodeIds: [] }),
    ]);
  });
});

describe("deleteEpisodeFreeWindow", () => {
  it("reports a delete that removed the window", async () => {
    mockDeleteEpisodeFreeWindow.mockResolvedValue({});

    const { deleteEpisodeFreeWindow } = await import("./episode-free-window");
    const result = await deleteEpisodeFreeWindow(
      { freeWindowId: "WINDOW1", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({ alreadyDeleted: false, ok: true });
  });

  // Another operator deleted it first, or an earlier attempt committed and
  // lost its response: the window is gone either way, as the delete asked.
  it("treats a window that is already gone as deleted", async () => {
    mockDeleteEpisodeFreeWindow.mockRejectedValue(
      new ConnectError("gone", Code.NotFound)
    );

    const { deleteEpisodeFreeWindow } = await import("./episode-free-window");
    const result = await deleteEpisodeFreeWindow(
      { freeWindowId: "WINDOW1", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({ alreadyDeleted: true, ok: true });
  });

  it("does not read a refused permission as a window that is gone", async () => {
    mockDeleteEpisodeFreeWindow.mockRejectedValue(
      new ConnectError("denied", Code.PermissionDenied)
    );

    const { deleteEpisodeFreeWindow } = await import("./episode-free-window");
    const result = await deleteEpisodeFreeWindow(
      { freeWindowId: "WINDOW1", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toMatchObject({ ok: false });
  });
});
