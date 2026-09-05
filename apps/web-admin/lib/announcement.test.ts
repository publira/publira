import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSessionId,
  mockListAnnouncementsApi,
  mockCreateAnnouncementsApi,
  mockListTenantUsersApi,
} = vi.hoisted(() => ({
  mockCreateAnnouncementsApi: vi.fn(),
  mockGetSessionId: vi.fn(),
  mockListAnnouncementsApi: vi.fn(),
  mockListTenantUsersApi: vi.fn(),
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
    users: {
      listTenantUsers: mockListTenantUsersApi,
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
  audienceType: 1,
  body: "Announcement body",
  createdAt,
  id,
  linkUrl: "",
  targetUserName: "",
  targetUserPublicId: "",
  title: "Announcement title",
});

describe("announcement lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
    mockListTenantUsersApi.mockResolvedValue({ users: [] });
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
          audienceType: 2,
          body: "Announcement body",
          createdAt: "2026-04-04T00:00:00Z",
          id: "n1",
          linkUrl: "/series/S001",
          targetUserName: "User One",
          targetUserPublicId: "USER001",
          title: "Announcement title",
        },
      ],
    });

    const { listAnnouncements } = await import("./announcement");
    const result = await listAnnouncements("TENANT001", "en", {});

    expect(result.ok).toBe(true);
    expect(result.announcements).toEqual([
      {
        audienceType: "selected",
        body: "Announcement body",
        createdAt: "2026-04-04T00:00:00Z",
        id: "n1",
        linkUrl: "/series/S001",
        targetUserName: "User One",
        targetUserPublicId: "USER001",
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
      message: "You do not have permission to perform this action.",
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

  it("does not read the target users while listing announcements", async () => {
    mockListAnnouncementsApi.mockResolvedValue({ announcements: [] });

    const { listAnnouncements } = await import("./announcement");
    await listAnnouncements("TENANT001", "en", {});

    // Only the creation screen needs the target users, so they are not fetched
    // alongside every listing.
    expect(mockListTenantUsersApi).not.toHaveBeenCalled();
  });

  it("follows the cursor to collect every page of target users", async () => {
    mockListTenantUsersApi
      .mockResolvedValueOnce({
        nextToken: "page-2",
        users: [{ name: "Zoe Bell", publicId: "USER001" }],
      })
      .mockResolvedValueOnce({
        nextToken: "",
        users: [{ name: "Ada Clark", publicId: "USER002" }],
      });

    const { listAllAnnouncementTargetUsers } = await import("./announcement");
    const result = await listAllAnnouncementTargetUsers("TENANT001", "en");

    expect(mockListTenantUsersApi).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        query: "",
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockListTenantUsersApi).toHaveBeenNthCalledWith(
      2,
      {
        limit: 100,
        query: "",
        tenant: { tenantId: "TENANT001" },
        token: "page-2",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    // The second page's candidates join the choices too, and the whole set is
    // sorted by name.
    expect(result).toEqual({
      ok: true,
      users: [
        { name: "Ada Clark", publicId: "USER002" },
        { name: "Zoe Bell", publicId: "USER001" },
      ],
    });
  });

  it("offers no choices when the target users cannot be read to the last page", async () => {
    // A broken response that keeps returning the same token. Presenting the
    // candidates gathered so far as "everyone" would hide that the people
    // missing from the list cannot be chosen at all.
    mockListTenantUsersApi.mockResolvedValue({
      nextToken: "same-token",
      users: [{ name: "Zoe Bell", publicId: "USER001" }],
    });

    const { listAllAnnouncementTargetUsers } = await import("./announcement");
    const result = await listAllAnnouncementTargetUsers("TENANT001", "en");

    expect(result).toEqual({
      message: "Could not load the list of target users.",
      ok: false,
      requiresSignIn: false,
      users: [],
    });
  });

  it("returns a message when the target users cannot be fetched", async () => {
    mockListTenantUsersApi.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listAllAnnouncementTargetUsers } = await import("./announcement");
    const result = await listAllAnnouncementTargetUsers("TENANT001", "en");

    expect(result).toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
      requiresSignIn: false,
      users: [],
    });
  });

  it("returns the count once the announcement is created", async () => {
    mockCreateAnnouncementsApi.mockResolvedValue({
      announcements: [{ id: "n1" }, { id: "n2" }],
    });

    const { createAnnouncement } = await import("./announcement");
    const result = await createAnnouncement(
      {
        audienceType: "all",
        body: "Announcement body",
        linkUrl: "",
        targetUserPublicIds: [],
        tenantId: "TENANT001",
        title: "Announcement title",
      },
      "en"
    );

    expect(result).toEqual({ createdCount: 2, ok: true });
  });
});
