import {
  AnnouncementDelivery,
  SubscriptionState,
} from "@publira/api-client/admin/announcement";
import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCountAnnouncementAudienceApi,
  mockDeleteAnnouncementApi,
  mockGetSessionId,
  mockListAnnouncementsApi,
  mockCreateAnnouncementsApi,
  mockUpdateAnnouncementApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCountAnnouncementAudienceApi: vi.fn(),
  mockCreateAnnouncementsApi: vi.fn(),
  mockDeleteAnnouncementApi: vi.fn(),
  mockGetSessionId: vi.fn(),
  mockListAnnouncementsApi: vi.fn(),
  mockUpdateAnnouncementApi: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetSessionId,
}));

vi.mock("./api", () => ({
  apiClient: {
    announcement: {
      countAnnouncementAudience: mockCountAnnouncementAudienceApi,
      createAnnouncement: mockCreateAnnouncementsApi,
      deleteAnnouncement: mockDeleteAnnouncementApi,
      listAnnouncements: mockListAnnouncementsApi,
      updateAnnouncement: mockUpdateAnnouncementApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: vi.fn(),
}));

const announcement = (id: string, createdAt: string) => ({
  body: "Announcement body",
  createdAt,
  id,
  linkUrl: "",
  title: "Announcement title",
});

describe("announcement lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it("passes the cursor token and the limit through and returns the tokens of the response", async () => {
    mockListAnnouncementsApi.mockResolvedValue({
      announcements: [],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    const { listAnnouncements } = await import("./announcement");

    const result = await listAnnouncements("TENANT001", "en", {
      limit: 20,
      token: "current-page",
    });

    expect(mockListAnnouncementsApi).toHaveBeenCalledWith(
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

  it("fetches the first page with an empty token and the default limit", async () => {
    mockListAnnouncementsApi.mockResolvedValue({ announcements: [] });

    const { listAnnouncements } = await import("./announcement");
    const result = await listAnnouncements("TENANT001", "en", {});

    expect(mockListAnnouncementsApi).toHaveBeenCalledWith(
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

  it("converts the announcement list", async () => {
    mockListAnnouncementsApi.mockResolvedValue({
      announcements: [
        {
          body: "Announcement body",
          createdAt: "2026-04-04T00:00:00Z",
          deliveredCount: 1200n,
          delivery: AnnouncementDelivery.EVERYONE,
          id: "n1",
          linkUrl: "/series/S001",
          openedCount: 37n,
          title: "Announcement title",
          translations: [
            { body: "", locale: "en", title: "" },
            // Stored after English, listed before it in the registry's order.
            { body: "", locale: "ja", title: "" },
            // A code this build serves no catalog for.
            { body: "", locale: "xx", title: "" },
          ],
        },
      ],
    });

    const { listAnnouncements } = await import("./announcement");
    const result = await listAnnouncements("TENANT001", "en", {});

    expect(result.ok).toBe(true);
    expect(result.announcements).toEqual([
      {
        audience: null,
        body: "Announcement body",
        createdAt: "2026-04-04T00:00:00Z",
        deliverAt: "",
        deliveredAt: "",
        deliveredCount: 1200n,
        delivery: "everyone",
        id: "n1",
        linkUrl: "/series/S001",
        openedCount: 37n,
        title: "Announcement title",
        translatedLocales: ["ja", "en"],
        translations: [
          { body: "", locale: "en", title: "" },
          { body: "", locale: "ja", title: "" },
        ],
      },
    ]);
  });

  it("returns the keyset order of the server without re-sorting it", async () => {
    mockListAnnouncementsApi.mockResolvedValue({
      announcements: [
        announcement("n2", "2026-04-01T00:00:00Z"),
        announcement("n1", "2026-06-01T00:00:00Z"),
      ],
    });

    const { listAnnouncements } = await import("./announcement");
    const result = await listAnnouncements("TENANT001", "en", {});

    expect(result.announcements.map((item) => item.id)).toEqual(["n2", "n1"]);
  });

  it("returns a legible message for a permission error", async () => {
    mockListAnnouncementsApi.mockRejectedValue(
      new ConnectError("tenant admin role required", Code.PermissionDenied)
    );

    const { listAnnouncements } = await import("./announcement");
    const result = await listAnnouncements("TENANT001", "en", {});

    expect(result).toEqual({
      announcements: [],
      message:
        "You do not have permission to perform this action. Go back or use an account that does.",
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

  it("returns a result with no token when there is no session", async () => {
    mockGetSessionId.mockResolvedValue("");

    const { listAnnouncements } = await import("./announcement");

    const result = await listAnnouncements("TENANT001", "en", {
      token: "current-page",
    });

    expect(mockListAnnouncementsApi).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      announcements: [],
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

  it("returns a result with no token when the fetch fails", async () => {
    mockListAnnouncementsApi.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listAnnouncements } = await import("./announcement");

    const result = await listAnnouncements("TENANT001", "en", {
      token: "current-page",
    });

    expect(result).toMatchObject({
      announcements: [],
      nextToken: "",
      ok: false,
      previousToken: "",
    });
  });

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockListAnnouncementsApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { listAnnouncements } = await import("./announcement");

    await expect(listAnnouncements("TENANT001", "en")).rejects.toThrow(Error);
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("sends every translation in the one request that creates the announcement", async () => {
    mockCreateAnnouncementsApi.mockResolvedValue({
      announcement: { id: "n1" },
    });

    const { createAnnouncement } = await import("./announcement");

    const result = await createAnnouncement(
      {
        audience: null,
        deliverAt: "",
        delivery: "everyone",
        linkUrl: "",
        pinned: false,
        pinnedUntil: "",
        tenantId: "TENANT001",
        translations: [
          {
            body: "Announcement body",
            locale: "",
            title: "Announcement title",
          },
          { body: "Japanese body", locale: "ja", title: "Japanese title" },
        ],
      },
      "en"
    );

    expect(result).toEqual({ ok: true });
    expect(mockCreateAnnouncementsApi).toHaveBeenCalledOnce();
    expect(mockCreateAnnouncementsApi).toHaveBeenCalledWith(
      {
        audience: undefined,
        deliverAt: "",
        delivery: AnnouncementDelivery.EVERYONE,
        linkUrl: "",
        pinned: false,
        pinnedUntil: "",
        tenant: { tenantId: "TENANT001" },
        translations: [
          {
            body: "Announcement body",
            locale: "",
            title: "Announcement title",
          },
          { body: "Japanese body", locale: "ja", title: "Japanese title" },
        ],
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("sends every condition of a targeted audience and the time it goes out at", async () => {
    mockCreateAnnouncementsApi.mockResolvedValue({
      announcement: { id: "n1" },
    });

    const { createAnnouncement } = await import("./announcement");

    await createAnnouncement(
      {
        audience: [
          { seriesPublicId: "SERIES001", type: "follows_series" },
          { planPublicId: "", state: "ended", type: "subscription" },
          { days: 30, type: "last_read_days_ago" },
          { locale: "ja", type: "locale" },
          { type: "has_mobile_push_device" },
        ],
        deliverAt: "2099-06-01T00:00:00Z",
        delivery: "preferred",
        linkUrl: "",
        pinned: false,
        pinnedUntil: "",
        tenantId: "TENANT001",
        translations: [{ body: "Body", locale: "", title: "Title" }],
      },
      "en"
    );

    expect(mockCreateAnnouncementsApi).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: {
          conditions: [
            {
              condition: {
                case: "followsSeries",
                value: { seriesPublicId: "SERIES001" },
              },
            },
            {
              condition: {
                case: "subscription",
                value: { planPublicId: "", state: SubscriptionState.ENDED },
              },
            },
            {
              condition: { case: "lastReadDaysAgo", value: { days: 30 } },
            },
            { condition: { case: "locale", value: { locale: "ja" } } },
            { condition: { case: "hasMobilePushDevice", value: {} } },
          ],
        },
        deliverAt: "2099-06-01T00:00:00Z",
      }),
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("reads a stored audience and the times an announcement goes and went out at", async () => {
    mockListAnnouncementsApi.mockResolvedValue({
      announcements: [
        {
          ...announcement("n1", "2026-04-04T00:00:00Z"),
          audience: {
            conditions: [
              {
                condition: {
                  case: "boughtSeriesEpisode",
                  value: { seriesPublicId: "SERIES001" },
                },
              },
              {
                condition: {
                  case: "subscription",
                  value: {
                    planPublicId: "PLAN001",
                    state: SubscriptionState.ACTIVE,
                  },
                },
              },
              { condition: { case: "neverPurchased", value: {} } },
              {
                condition: { case: "signedUpWithinDays", value: { days: 7 } },
              },
              // A code this build serves no catalog for.
              { condition: { case: "locale", value: { locale: "xx" } } },
            ],
          },
          deliverAt: "2099-06-01T00:00:00Z",
          deliveredAt: "",
        },
        announcement("n2", "2026-04-01T00:00:00Z"),
      ],
    });

    const { listAnnouncements } = await import("./announcement");
    const result = await listAnnouncements("TENANT001", "en", {});

    expect(result.announcements.map(({ audience }) => audience)).toEqual([
      [
        { seriesPublicId: "SERIES001", type: "bought_series_episode" },
        { planPublicId: "PLAN001", state: "active", type: "subscription" },
        { type: "never_purchased" },
        { days: 7, type: "signed_up_within_days" },
      ],
      null,
    ]);
    expect(result.announcements[0]).toMatchObject({
      deliverAt: "2099-06-01T00:00:00Z",
      deliveredAt: "",
    });
  });

  it("finds one announcement on a later page of the list for its edit screen", async () => {
    mockListAnnouncementsApi
      .mockResolvedValueOnce({
        announcements: [announcement("n3", "2026-06-01T00:00:00Z")],
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        announcements: [announcement("n2", "2026-05-01T00:00:00Z")],
        nextToken: "page-3",
      });

    const { getAnnouncement } = await import("./announcement");

    const result = await getAnnouncement(
      { announcementId: "n2", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toMatchObject({ announcement: { id: "n2" }, ok: true });
    // The walk stops at the page that holds it.
    expect(mockListAnnouncementsApi).toHaveBeenCalledTimes(2);
    expect(mockListAnnouncementsApi).toHaveBeenLastCalledWith(
      expect.objectContaining({ token: "page-2" }),
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("answers no announcement when the list ends without it", async () => {
    mockListAnnouncementsApi.mockResolvedValue({
      announcements: [announcement("n1", "2026-06-01T00:00:00Z")],
    });

    const { getAnnouncement } = await import("./announcement");

    await expect(
      getAnnouncement({ announcementId: "n9", tenantId: "TENANT001" }, "en")
    ).resolves.toEqual({ announcement: null, ok: true });
  });

  it("says a save came too late once the announcement has gone out", async () => {
    mockUpdateAnnouncementApi.mockRejectedValue(
      new ConnectError("already delivered", Code.FailedPrecondition)
    );

    const { updateAnnouncement } = await import("./announcement");

    const result = await updateAnnouncement(
      {
        announcementId: "n1",
        audience: null,
        deliverAt: "",
        delivery: "preferred",
        linkUrl: "",
        pinned: false,
        pinnedUntil: "",
        tenantId: "TENANT001",
        translations: [{ body: "Body", locale: "", title: "Title" }],
      },
      "en"
    );

    expect(mockUpdateAnnouncementApi).toHaveBeenCalledWith(
      expect.objectContaining({ announcementId: "n1", deliverAt: "" }),
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      message:
        "The announcement has already gone out, so it can no longer be changed or deleted.",
      ok: false,
    });
  });

  it("deletes a scheduled announcement by its id", async () => {
    mockDeleteAnnouncementApi.mockResolvedValue({});

    const { deleteAnnouncement } = await import("./announcement");

    await expect(
      deleteAnnouncement({ announcementId: "n1", tenantId: "TENANT001" }, "en")
    ).resolves.toEqual({ ok: true });
    expect(mockDeleteAnnouncementApi).toHaveBeenCalledWith(
      { announcementId: "n1", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("counts the readers an audience selects, and reports a failure as one", async () => {
    mockCountAnnouncementAudienceApi.mockResolvedValueOnce({
      readerCount: 12n,
    });

    const { countAnnouncementAudience } = await import("./announcement");

    const input = {
      audience: [{ type: "never_purchased" as const }],
      tenantId: "TENANT001",
    };

    await expect(countAnnouncementAudience(input)).resolves.toEqual({
      ok: true,
      readerCount: 12n,
    });
    expect(mockCountAnnouncementAudienceApi).toHaveBeenCalledWith(
      {
        audience: {
          conditions: [{ condition: { case: "neverPurchased", value: {} } }],
        },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );

    mockCountAnnouncementAudienceApi.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );

    await expect(countAnnouncementAudience(input)).resolves.toEqual({
      ok: false,
    });
  });
});
