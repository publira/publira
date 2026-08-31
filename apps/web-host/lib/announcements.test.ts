import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAnnouncement,
  mockListAnnouncements,
  mockMarkAllAnnouncementsAsRead,
  mockMarkAnnouncementAsRead,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockGetAnnouncement: vi.fn(),
  mockListAnnouncements: vi.fn(),
  mockMarkAllAnnouncementsAsRead: vi.fn(),
  mockMarkAnnouncementAsRead: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    auth: {
      getAnnouncement: mockGetAnnouncement,
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

describe("web-host announcements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("sid_001");
  });

  it("listMyAnnouncements: Convert API responses for screen", async () => {
    const { listMyAnnouncements } = await importAnnouncements();

    mockListAnnouncements.mockResolvedValueOnce({
      announcements: [
        {
          body: "本文",
          createdAt: "2026-04-05T10:00:00Z",
          id: "N001",
          isRead: false,
          linkUrl: "/series/S001",
          title: "お知らせ",
        },
      ],
      nextToken: "djF8Zg",
      previousToken: "",
    });

    await expect(
      listMyAnnouncements("TENANT001", undefined, { locale: "ja" })
    ).resolves.toEqual({
      announcements: [
        {
          body: "本文",
          createdAt: "2026-04-05T10:00:00Z",
          id: "N001",
          isRead: false,
          linkUrl: "/series/S001",
          title: "お知らせ",
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

    await listMyAnnouncements("TENANT001", undefined, { locale: "ja" });

    expect(mockListAnnouncements).toHaveBeenCalledWith(
      { limit: 20, tenant: { tenantId: "TENANT001" }, token: "" },
      expect.anything()
    );
  });

  it("listMyAnnouncements: Post the passed cursor and number as is to RPC", async () => {
    const { listMyAnnouncements } = await importAnnouncements();
    mockListAnnouncements.mockResolvedValueOnce({ announcements: [] });

    await listMyAnnouncements("TENANT001", "sid_001", {
      limit: 5,
      locale: "ja",
      token: "djF8Zg",
    });

    expect(mockListAnnouncements).toHaveBeenCalledWith(
      { limit: 5, tenant: { tenantId: "TENANT001" }, token: "djF8Zg" },
      expect.anything()
    );
  });

  it("listMyAnnouncements: Uncategorized RPC errors propagate", async () => {
    const { listMyAnnouncements } = await importAnnouncements();
    const error = new ConnectError("boom", Code.Internal);
    mockListAnnouncements.mockRejectedValueOnce(error);

    await expect(
      listMyAnnouncements("TENANT001", undefined, { locale: "ja" })
    ).rejects.toBe(error);
  });

  it("getMyAnnouncement: Return 1 approved", async () => {
    const { getMyAnnouncement } = await importAnnouncements();

    mockGetAnnouncement.mockResolvedValueOnce({
      announcement: {
        body: "本文",
        createdAt: "2026-04-05T10:00:00Z",
        id: announcementId,
        isRead: false,
        linkUrl: "/series/S001",
        title: "お知らせ",
      },
    });

    await expect(getMyAnnouncement(tenantId, announcementId)).resolves.toEqual({
      body: "本文",
      createdAt: "2026-04-05T10:00:00Z",
      id: announcementId,
      isRead: false,
      linkUrl: "/series/S001",
      title: "お知らせ",
    });
    expect(mockGetAnnouncement).toHaveBeenCalledWith(
      { announcementId, tenant: { tenantId } },
      expect.anything()
    );
    expect(mockListAnnouncements).not.toHaveBeenCalled();
  });

  it("getMyAnnouncement: Remove leading and trailing spaces and pass to RPC", async () => {
    const { getMyAnnouncement } = await importAnnouncements();
    mockGetAnnouncement.mockResolvedValueOnce({
      announcement: {
        body: "本文",
        createdAt: "2026-04-05T10:00:00Z",
        id: announcementId,
        isRead: false,
        linkUrl: "/series/S001",
        title: "お知らせ",
      },
    });

    await expect(
      getMyAnnouncement(`  ${tenantId}  `, `  ${announcementId}  `)
    ).resolves.toMatchObject({ id: announcementId });
    expect(mockGetAnnouncement).toHaveBeenCalledWith(
      { announcementId, tenant: { tenantId } },
      expect.anything()
    );
  });

  it("getMyAnnouncement: invalid input is null without calling RPC", async () => {
    const { getMyAnnouncement } = await importAnnouncements();

    await expect(
      getMyAnnouncement("TENANT001", announcementId)
    ).resolves.toBeNull();
    await expect(getMyAnnouncement(tenantId, "N001")).resolves.toBeNull();
    await expect(getMyAnnouncement(tenantId, "   ")).resolves.toBeNull();
    expect(mockGetAnnouncement).not.toHaveBeenCalled();
    expect(mockResolveAccessToken).not.toHaveBeenCalled();
  });

  it("getMyAnnouncement: null if no session", async () => {
    const { getMyAnnouncement } = await importAnnouncements();
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(
      getMyAnnouncement(tenantId, announcementId)
    ).resolves.toBeNull();
    expect(mockGetAnnouncement).not.toHaveBeenCalled();
  });

  it("getMyAnnouncement: null for missing rows", async () => {
    const { getMyAnnouncement } = await importAnnouncements();
    mockGetAnnouncement.mockRejectedValueOnce(
      new ConnectError("announcement not found", Code.NotFound)
    );

    await expect(
      getMyAnnouncement(tenantId, "33333333-3333-4333-8333-333333333333")
    ).resolves.toBeNull();
    expect(mockListAnnouncements).not.toHaveBeenCalled();
  });

  it("getMyAnnouncement: null if announcement is missing", async () => {
    const { getMyAnnouncement } = await importAnnouncements();
    mockGetAnnouncement.mockResolvedValueOnce({});

    await expect(
      getMyAnnouncement(tenantId, announcementId)
    ).resolves.toBeNull();
  });

  it("getMyAnnouncement: Uncategorized RPC errors propagate", async () => {
    const { getMyAnnouncement } = await importAnnouncements();
    const error = new ConnectError("boom", Code.Internal);
    mockGetAnnouncement.mockRejectedValueOnce(error);

    await expect(getMyAnnouncement(tenantId, announcementId)).rejects.toBe(
      error
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
