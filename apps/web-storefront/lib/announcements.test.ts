import {
  Code,
  ConnectError,
  isUnauthenticatedRpcError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAnnouncement,
  mockGetPinnedAnnouncement,
  mockListAnnouncements,
  mockMarkAllAnnouncementsAsRead,
  mockMarkAnnouncementAsRead,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockGetAnnouncement: vi.fn(),
  mockGetPinnedAnnouncement: vi.fn(),
  mockListAnnouncements: vi.fn(),
  mockMarkAllAnnouncementsAsRead: vi.fn(),
  mockMarkAnnouncementAsRead: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    auth: {
      getAnnouncement: mockGetAnnouncement,
      getPinnedAnnouncement: mockGetPinnedAnnouncement,
      listAnnouncements: mockListAnnouncements,
      markAllAnnouncementsAsRead: mockMarkAllAnnouncementsAsRead,
      markAnnouncementAsRead: mockMarkAnnouncementAsRead,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

const importAnnouncements = () => import("./announcements");

const tenantId = "11111111-1111-4111-8111-111111111111";
const announcementId = "22222222-2222-4222-8222-222222222222";

const rawItem = {
  body: "Body",
  createdAt: "2026-04-05T10:00:00Z",
  id: announcementId,
  isRead: false,
  linkUrl: "/series/S001",
  locale: "en",
  title: "Announcement",
};

describe("web-storefront announcements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("sid_001");
  });

  it("listMyAnnouncements: Convert API responses for screen", async () => {
    const { listMyAnnouncements } = await importAnnouncements();

    mockListAnnouncements.mockResolvedValueOnce({
      announcements: [
        {
          body: "Body",
          createdAt: "2026-04-05T10:00:00Z",
          id: "N001",
          isRead: false,
          linkUrl: "/series/S001",
          locale: "en",
          title: "Announcement",
        },
      ],
      nextToken: "djF8Zg",
      previousToken: "",
    });

    await expect(
      listMyAnnouncements("TENANT001", undefined, { locale: "en" })
    ).resolves.toEqual({
      announcements: [
        {
          body: "Body",
          createdAt: "2026-04-05T10:00:00Z",
          id: "N001",
          isRead: false,
          linkUrl: "/series/S001",
          locale: "en",
          title: "Announcement",
        },
      ],
      nextToken: "djF8Zg",
      ok: true,
      previousToken: "",
    });
  });

  it("listMyAnnouncements: If token is not specified, pull the first page with the default number of items.", async () => {
    const { listMyAnnouncements } = await importAnnouncements();
    mockListAnnouncements.mockResolvedValueOnce({ announcements: [] });

    await listMyAnnouncements("TENANT001", undefined, { locale: "en" });

    expect(mockListAnnouncements).toHaveBeenCalledWith(
      { limit: 20, locale: "en", tenant: { tenantId: "TENANT001" }, token: "" },
      expect.anything()
    );
  });

  it("listMyAnnouncements: Post the passed cursor and number as is to RPC", async () => {
    const { listMyAnnouncements } = await importAnnouncements();
    mockListAnnouncements.mockResolvedValueOnce({ announcements: [] });

    await listMyAnnouncements("TENANT001", "sid_001", {
      limit: 5,
      locale: "en",
      token: "djF8Zg",
    });

    expect(mockListAnnouncements).toHaveBeenCalledWith(
      {
        limit: 5,
        locale: "en",
        tenant: { tenantId: "TENANT001" },
        token: "djF8Zg",
      },
      expect.anything()
    );
  });

  it("listMyAnnouncements: asks in the reader's locale and keeps the one each row was served in", async () => {
    const { listMyAnnouncements } = await importAnnouncements();
    mockListAnnouncements.mockResolvedValueOnce({
      announcements: [
        { ...rawItem, id: "N001", locale: "en" },
        { ...rawItem, id: "N002", locale: "ja" },
        { ...rawItem, id: "N003", locale: "" },
      ],
    });

    const result = await listMyAnnouncements("TENANT001", undefined, {
      locale: "en",
    });

    expect(mockListAnnouncements).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "en" }),
      expect.anything()
    );
    // An unreadable served locale claims no fallback it cannot name.
    expect(
      result.announcements.map(({ id, locale }) => ({ id, locale }))
    ).toEqual([
      { id: "N001", locale: "en" },
      { id: "N002", locale: "ja" },
      { id: "N003", locale: "en" },
    ]);
  });

  it("listMyAnnouncements: reports an unreachable API as the section's message", async () => {
    const { listMyAnnouncements } = await importAnnouncements();
    mockListAnnouncements.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(
      listMyAnnouncements("TENANT001", undefined, { locale: "en" })
    ).resolves.toEqual({
      announcements: [],
      message: "Could not connect to the server. Please try again later.",
      nextToken: "",
      ok: false,
      previousToken: "",
    });
  });

  it("listMyAnnouncements: reports a rejected session as the section's message", async () => {
    const { listMyAnnouncements } = await importAnnouncements();
    mockListAnnouncements.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    await expect(
      listMyAnnouncements("TENANT001", undefined, { locale: "en" })
    ).resolves.toMatchObject({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
    });
  });

  it("listMyAnnouncements: throws a failure it cannot explain without handing out the caught error", async () => {
    const { listMyAnnouncements } = await importAnnouncements();
    const error = new ConnectError("boom", Code.Internal);
    mockListAnnouncements.mockRejectedValueOnce(error);

    // The error the cache scope caught never leaves it, so what is thrown is
    // built outside from the scope's verdict alone — the same thing a
    // production build sees once the boundary has stripped the `Code`.
    await expect(
      listMyAnnouncements("TENANT001", undefined, { locale: "en" })
    ).rejects.toSatisfy(
      (cause: unknown) =>
        cause !== error &&
        cause instanceof Error &&
        cause.message ===
          "Could not load the announcements. Please try again later."
    );
  });

  it("getMyAnnouncement: Return 1 approved", async () => {
    const { getMyAnnouncement } = await importAnnouncements();

    mockGetAnnouncement.mockResolvedValueOnce({
      announcement: {
        body: "Body",
        createdAt: "2026-04-05T10:00:00Z",
        id: announcementId,
        isRead: false,
        linkUrl: "/series/S001",
        locale: "ja",
        title: "Announcement",
      },
    });

    await expect(
      getMyAnnouncement(tenantId, announcementId, "en")
    ).resolves.toEqual({
      body: "Body",
      createdAt: "2026-04-05T10:00:00Z",
      id: announcementId,
      isRead: false,
      linkUrl: "/series/S001",
      locale: "ja",
      title: "Announcement",
    });
    expect(mockGetAnnouncement).toHaveBeenCalledWith(
      { announcementId, locale: "en", tenant: { tenantId } },
      expect.anything()
    );
    expect(mockListAnnouncements).not.toHaveBeenCalled();
  });

  it("getMyAnnouncement: Remove leading and trailing spaces and pass to RPC", async () => {
    const { getMyAnnouncement } = await importAnnouncements();
    mockGetAnnouncement.mockResolvedValueOnce({
      announcement: {
        body: "Body",
        createdAt: "2026-04-05T10:00:00Z",
        id: announcementId,
        isRead: false,
        linkUrl: "/series/S001",
        title: "Announcement",
      },
    });

    await expect(
      getMyAnnouncement(`  ${tenantId}  `, `  ${announcementId}  `, "en")
    ).resolves.toMatchObject({ id: announcementId });
    expect(mockGetAnnouncement).toHaveBeenCalledWith(
      { announcementId, locale: "en", tenant: { tenantId } },
      expect.anything()
    );
  });

  it("getMyAnnouncement: invalid input is null without calling RPC", async () => {
    const { getMyAnnouncement } = await importAnnouncements();

    await expect(
      getMyAnnouncement("TENANT001", announcementId, "en")
    ).resolves.toBeNull();
    await expect(getMyAnnouncement(tenantId, "N001", "en")).resolves.toBeNull();
    await expect(getMyAnnouncement(tenantId, "   ", "en")).resolves.toBeNull();
    expect(mockGetAnnouncement).not.toHaveBeenCalled();
    expect(mockResolveAccessToken).not.toHaveBeenCalled();
  });

  it("getMyAnnouncement: null if no session", async () => {
    const { getMyAnnouncement } = await importAnnouncements();
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(
      getMyAnnouncement(tenantId, announcementId, "en")
    ).resolves.toBeNull();
    expect(mockGetAnnouncement).not.toHaveBeenCalled();
  });

  it("getMyAnnouncement: null for missing rows", async () => {
    const { getMyAnnouncement } = await importAnnouncements();
    mockGetAnnouncement.mockRejectedValueOnce(
      new ConnectError("announcement not found", Code.NotFound)
    );

    await expect(
      getMyAnnouncement(tenantId, "33333333-3333-4333-8333-333333333333", "en")
    ).resolves.toBeNull();
    expect(mockListAnnouncements).not.toHaveBeenCalled();
  });

  it("getMyAnnouncement: null if announcement is missing", async () => {
    const { getMyAnnouncement } = await importAnnouncements();
    mockGetAnnouncement.mockResolvedValueOnce({});

    await expect(
      getMyAnnouncement(tenantId, announcementId, "en")
    ).resolves.toBeNull();
  });

  it("getMyAnnouncement: null when the API cannot be reached", async () => {
    const { getMyAnnouncement } = await importAnnouncements();
    mockGetAnnouncement.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(
      getMyAnnouncement(tenantId, announcementId, "en")
    ).resolves.toBeNull();
  });

  it("getMyAnnouncement: a rejected session is thrown as unauthenticated, not as a bug", async () => {
    const { getMyAnnouncement } = await importAnnouncements();
    const error = new ConnectError("session expired", Code.Unauthenticated);
    mockGetAnnouncement.mockRejectedValueOnce(error);

    // Rebuilt outside the cache scope from its verdict, so the `Code` that
    // sends the reader back through sign-in survives a production build.
    await expect(
      getMyAnnouncement(tenantId, announcementId, "en")
    ).rejects.toSatisfy(
      (cause: unknown) => cause !== error && isUnauthenticatedRpcError(cause)
    );
  });

  it("getMyAnnouncement: throws a failure it cannot explain without handing out the caught error", async () => {
    const { getMyAnnouncement } = await importAnnouncements();
    const error = new ConnectError("boom", Code.Internal);
    mockGetAnnouncement.mockRejectedValueOnce(error);

    await expect(
      getMyAnnouncement(tenantId, announcementId, "en")
    ).rejects.toSatisfy(
      (cause: unknown) =>
        cause instanceof Error && !(cause instanceof ConnectError)
    );
  });

  it("markAnnouncementAsRead: false if no session", async () => {
    const { markAnnouncementAsRead } = await importAnnouncements();
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(markAnnouncementAsRead("TENANT001", "N001")).resolves.toBe(
      false
    );
  });

  it("markAnnouncementAsRead: true on API success", async () => {
    const { markAnnouncementAsRead } = await importAnnouncements();
    mockMarkAnnouncementAsRead.mockResolvedValueOnce({ marked: true });

    await expect(markAnnouncementAsRead("TENANT001", "N001")).resolves.toBe(
      true
    );
  });

  it("markAllAnnouncementsAsRead: Return count", async () => {
    const { markAllAnnouncementsAsRead } = await importAnnouncements();
    mockMarkAllAnnouncementsAsRead.mockResolvedValueOnce({ markedCount: 3 });

    await expect(markAllAnnouncementsAsRead("TENANT001")).resolves.toBe(3);
  });
});

describe("web-storefront announcement page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads one announcement without a session, in the reader's locale", async () => {
    const { getAnnouncement } = await importAnnouncements();
    mockGetAnnouncement.mockResolvedValueOnce({
      announcement: rawItem,
      locales: ["en", "ja"],
    });

    await expect(
      getAnnouncement(tenantId, announcementId, "en")
    ).resolves.toEqual({
      ok: true,
      value: {
        body: "Body",
        createdAt: "2026-04-05T10:00:00Z",
        id: announcementId,
        linkUrl: "/series/S001",
        locale: "en",
        publishedLocales: ["en", "ja"],
        title: "Announcement",
      },
    });
    expect(mockGetAnnouncement).toHaveBeenCalledWith({
      announcementId,
      locale: "en",
      tenant: { tenantId },
    });
    expect(mockResolveAccessToken).not.toHaveBeenCalled();
  });

  it("names the translation it fell back to among the languages of the page", async () => {
    const { getAnnouncement } = await importAnnouncements();
    mockGetAnnouncement.mockResolvedValueOnce({
      announcement: { ...rawItem, locale: "ja" },
      locales: ["fr", "zh-Hans"],
    });

    // `fr` is no locale this build knows, and the served translation exists
    // even when the list left it out.
    await expect(
      getAnnouncement(tenantId, announcementId, "en")
    ).resolves.toMatchObject({
      ok: true,
      value: { locale: "ja", publishedLocales: ["zh-Hans", "ja"] },
    });
  });

  it("answers null for a missing announcement and for an id that cannot be one", async () => {
    const { getAnnouncement } = await importAnnouncements();
    mockGetAnnouncement.mockRejectedValueOnce(
      new ConnectError("announcement not found", Code.NotFound)
    );

    await expect(
      getAnnouncement(tenantId, announcementId, "en")
    ).resolves.toEqual({ ok: true, value: null });
    await expect(getAnnouncement(tenantId, "N001", "en")).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(mockGetAnnouncement).toHaveBeenCalledTimes(1);
  });

  it("reports a failed read as a value in the reader's language", async () => {
    const { getAnnouncement } = await importAnnouncements();
    mockGetAnnouncement.mockRejectedValueOnce(
      new ConnectError("handler panicked", Code.Internal)
    );

    await expect(
      getAnnouncement(tenantId, announcementId, "en")
    ).resolves.toEqual({
      message: "Could not load the announcement. Please try again later.",
      ok: false,
    });
  });
});

describe("web-storefront pinned announcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("carries no session, so one entry answers every visitor of a tenant", async () => {
    const { getPinnedAnnouncement } = await importAnnouncements();
    mockGetPinnedAnnouncement.mockResolvedValueOnce({
      announcement: {
        body: "We will be down for an hour",
        createdAt: "2026-04-05T10:00:00Z",
        id: announcementId,
        isRead: false,
        linkUrl: "/pages/maintenance",
        locale: "ja",
        pinned: true,
        pinnedUntil: "2026-04-06T10:00:00Z",
        title: "Maintenance tonight",
      },
    });

    await expect(getPinnedAnnouncement(tenantId, "en")).resolves.toEqual({
      body: "We will be down for an hour",
      id: announcementId,
      linkUrl: "/pages/maintenance",
      locale: "ja",
      title: "Maintenance tonight",
    });
    expect(mockGetPinnedAnnouncement).toHaveBeenCalledWith({
      locale: "en",
      tenant: { tenantId },
    });
    expect(mockResolveAccessToken).not.toHaveBeenCalled();
  });

  it("answers nothing when the tenant has nothing pinned", async () => {
    const { getPinnedAnnouncement } = await importAnnouncements();
    mockGetPinnedAnnouncement.mockResolvedValueOnce({});

    await expect(getPinnedAnnouncement(tenantId, "en")).resolves.toBeNull();
  });

  it("answers nothing when the read fails, so the band is simply not drawn", async () => {
    const { getPinnedAnnouncement } = await importAnnouncements();
    mockGetPinnedAnnouncement.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(getPinnedAnnouncement(tenantId, "en")).resolves.toBeNull();
  });

  it("reports an unexpected failure in the log rather than throwing", async () => {
    const { getPinnedAnnouncement } = await importAnnouncements();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new ConnectError("handler panicked", Code.Internal);
    mockGetPinnedAnnouncement.mockRejectedValueOnce(failure);

    // The banner renders on every page, so a throw would take the site down;
    // and past the cache boundary the failure could no longer be classified.
    await expect(getPinnedAnnouncement(tenantId, "en")).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[web-storefront] getPinnedAnnouncement failed",
      failure
    );
    warn.mockRestore();
  });

  it("asks for nothing when there is no tenant to ask about", async () => {
    const { getPinnedAnnouncement } = await importAnnouncements();

    await expect(getPinnedAnnouncement("  ", "en")).resolves.toBeNull();
    expect(mockGetPinnedAnnouncement).not.toHaveBeenCalled();
  });
});
