import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSessionId,
  mockListAnnouncementsApi,
  mockCreateAnnouncementsApi,
} = vi.hoisted(() => ({
  mockCreateAnnouncementsApi: vi.fn(),
  mockGetSessionId: vi.fn(),
  mockListAnnouncementsApi: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetSessionId,
}));

vi.mock("./api", () => ({
  apiClient: {
    announcement: {
      createAnnouncement: mockCreateAnnouncementsApi,
      listAnnouncements: mockListAnnouncementsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

vi.mock("next/cache", () => ({
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
          id: "n1",
          linkUrl: "/series/S001",
          title: "Announcement title",
        },
      ],
    });

    const { listAnnouncements } = await import("./announcement");
    const result = await listAnnouncements("TENANT001", "en", {});

    expect(result.ok).toBe(true);
    expect(result.announcements).toEqual([
      {
        body: "Announcement body",
        createdAt: "2026-04-04T00:00:00Z",
        id: "n1",
        linkUrl: "/series/S001",
        title: "Announcement title",
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

  it("returns the count once the announcement is created", async () => {
    mockCreateAnnouncementsApi.mockResolvedValue({
      announcements: [{ id: "n1" }, { id: "n2" }],
    });

    const { createAnnouncement } = await import("./announcement");
    const result = await createAnnouncement(
      {
        body: "Announcement body",
        linkUrl: "",
        pinned: false,
        pinnedUntil: "",
        tenantId: "TENANT001",
        title: "Announcement title",
      },
      "en"
    );

    expect(result).toEqual({ createdCount: 2, ok: true });
  });
});
