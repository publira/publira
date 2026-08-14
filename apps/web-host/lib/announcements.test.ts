import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListAnnouncements,
  mockMarkAllAnnouncementsAsRead,
  mockMarkAnnouncementAsRead,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockListAnnouncements: vi.fn(),
  mockMarkAllAnnouncementsAsRead: vi.fn(),
  mockMarkAnnouncementAsRead: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    auth: {
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
  cacheTag: vi.fn(),
  unstable_noStore: vi.fn(),
}));

const importAnnouncements = () => import("./announcements");

describe("web-host announcements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("sid_001");
  });

  it("listMyAnnouncements: API 応答を画面用に変換する", async () => {
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

    await expect(listMyAnnouncements("TENANT001")).resolves.toEqual({
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

  it("listMyAnnouncements: token を指定なしなら先頭ページを既定件数で引く", async () => {
    const { listMyAnnouncements } = await importAnnouncements();
    mockListAnnouncements.mockResolvedValueOnce({ announcements: [] });

    await listMyAnnouncements("TENANT001");

    expect(mockListAnnouncements).toHaveBeenCalledWith(
      { limit: 20, tenant: { tenantId: "TENANT001" }, token: "" },
      expect.anything()
    );
  });

  it("listMyAnnouncements: 渡された cursor と件数をそのまま RPC に載せる", async () => {
    const { listMyAnnouncements } = await importAnnouncements();
    mockListAnnouncements.mockResolvedValueOnce({ announcements: [] });

    await listMyAnnouncements("TENANT001", "sid_001", {
      limit: 5,
      token: "djF8Zg",
    });

    expect(mockListAnnouncements).toHaveBeenCalledWith(
      { limit: 5, tenant: { tenantId: "TENANT001" }, token: "djF8Zg" },
      expect.anything()
    );
  });

  it("getMyAnnouncement: 認可済み一覧から対象行を返す", async () => {
    const { getMyAnnouncement } = await importAnnouncements();

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
      nextToken: "",
      previousToken: "",
    });

    await expect(getMyAnnouncement("TENANT001", "N001")).resolves.toEqual({
      body: "本文",
      createdAt: "2026-04-05T10:00:00Z",
      id: "N001",
      isRead: false,
      linkUrl: "/series/S001",
      title: "お知らせ",
    });
  });

  it("getMyAnnouncement: 次ページまで辿って対象行を返す", async () => {
    const { getMyAnnouncement } = await importAnnouncements();

    mockListAnnouncements
      .mockResolvedValueOnce({
        announcements: [
          {
            body: "他",
            createdAt: "2026-04-05T10:00:00Z",
            id: "N000",
            isRead: true,
            linkUrl: "",
            title: "他",
          },
        ],
        nextToken: "djF8Zg",
        previousToken: "",
      })
      .mockResolvedValueOnce({
        announcements: [
          {
            body: "本文",
            createdAt: "2026-04-05T11:00:00Z",
            id: "N002",
            isRead: false,
            linkUrl: "https://example.com/a",
            title: "対象",
          },
        ],
        nextToken: "",
        previousToken: "djF8Zg",
      });

    await expect(getMyAnnouncement("TENANT001", "N002")).resolves.toEqual({
      body: "本文",
      createdAt: "2026-04-05T11:00:00Z",
      id: "N002",
      isRead: false,
      linkUrl: "https://example.com/a",
      title: "対象",
    });
    expect(mockListAnnouncements).toHaveBeenCalledTimes(2);
  });

  it("getMyAnnouncement: 見つからない行は null", async () => {
    const { getMyAnnouncement } = await importAnnouncements();
    mockListAnnouncements.mockResolvedValueOnce({
      announcements: [],
      nextToken: "",
      previousToken: "",
    });

    await expect(getMyAnnouncement("TENANT001", "N999")).resolves.toBeNull();
  });

  it("markAnnouncementAsRead: session が無ければ false", async () => {
    const { markAnnouncementAsRead } = await importAnnouncements();
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(markAnnouncementAsRead("TENANT001", "N001")).resolves.toBe(
      false
    );
  });

  it("markAnnouncementAsRead: API 成功時は true", async () => {
    const { markAnnouncementAsRead } = await importAnnouncements();
    mockMarkAnnouncementAsRead.mockResolvedValueOnce({ marked: true });

    await expect(markAnnouncementAsRead("TENANT001", "N001")).resolves.toBe(
      true
    );
  });

  it("markAllAnnouncementsAsRead: 件数を返す", async () => {
    const { markAllAnnouncementsAsRead } = await importAnnouncements();
    mockMarkAllAnnouncementsAsRead.mockResolvedValueOnce({ markedCount: 3 });

    await expect(markAllAnnouncementsAsRead("TENANT001")).resolves.toBe(3);
  });
});
