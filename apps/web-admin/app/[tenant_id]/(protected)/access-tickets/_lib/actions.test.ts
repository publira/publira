import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockIssueAccessTicket,
  mockRedirect,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockIssueAccessTicket: vi.fn(),
  mockRedirect: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/access-ticket", () => ({
  accessTicketsCacheTag: (tenantId: string) => `access-tickets-${tenantId}`,
  issueAccessTicket: mockIssueAccessTicket,
  revokeAccessTicket: vi.fn(),
}));

vi.mock("#lib/episode", () => ({
  listAllEpisodesForTenant: vi.fn(),
}));

const issueFormData = (): FormData => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("user_id", "018f0e6a-5000-7000-8000-000000000001");
  formData.set("episode_id", "018f0e6a-5000-7000-8000-000000000002");
  formData.set("expires_at", "");
  formData.set("note", "Review access");
  return formData;
};

const ticket = (status: string) => ({
  createdAt: "2026-01-05T11:00:00Z",
  episodePublicId: "EPISODE001",
  episodeTitle: "Episode 1",
  expiresAt: "",
  id: "018f0e6a-5000-7000-8000-000000000003",
  note: "",
  publicId: "TICKET000001",
  revokedAt: "",
  seriesPublicId: "SERIES001",
  seriesTitle: "Series 1",
  status,
  userEmail: "reader@example.com",
  userName: "Reader",
  userPublicId: "USER001",
});

describe("issueAccessTicketAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // `withAdminSessionReauth` resolves the session before the mutation runs;
    // without a token the Action under test would redirect to /login.
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns to the list with the issued notice when the ticket was created", async () => {
    mockIssueAccessTicket.mockResolvedValueOnce({
      created: true,
      ok: true,
      ticket: ticket("active"),
    });

    const { issueAccessTicketAction } = await import("./actions");
    await issueAccessTicketAction(null, issueFormData());

    expect(mockUpdateTag).toHaveBeenCalledWith("access-tickets-TENANT001");
    expect(mockRedirect).toHaveBeenCalledWith("/access-tickets?created=1");
  });

  it("names the active ticket the pair already has instead of reporting a new one", async () => {
    mockIssueAccessTicket.mockResolvedValueOnce({
      created: false,
      ok: true,
      ticket: ticket("active"),
    });

    const { issueAccessTicketAction } = await import("./actions");
    const result = await issueAccessTicketAction(null, issueFormData());

    expect(result).toEqual({
      message:
        "The same user and episode already have an active ticket (TICKET000001). Its expiry and note were left as they were; to change them, revoke it from the list and issue a new one.",
      ok: false,
    });
    // The message points at the list, which has to show the named ticket.
    expect(mockUpdateTag).toHaveBeenCalledWith("access-tickets-TENANT001");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("asks for the expired ticket the pair already has to be revoked first", async () => {
    mockIssueAccessTicket.mockResolvedValueOnce({
      created: false,
      ok: true,
      ticket: ticket("expired"),
    });

    const { issueAccessTicketAction } = await import("./actions");
    const result = await issueAccessTicketAction(null, issueFormData());

    expect(result).toEqual({
      message:
        "An expired ticket for the same user and episode (TICKET000001) has not been revoked. Revoke it from the list before setting a new expiry.",
      ok: false,
    });
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
