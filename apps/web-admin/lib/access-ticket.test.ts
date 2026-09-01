import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAccessToken, mockListAccessTickets } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockListAccessTickets: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    accessTickets: {
      listAccessTickets: mockListAccessTickets,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
}));

const ticket = (publicId: string, createdAt: string) => ({
  createdAt,
  episodePublicId: "EPISODE001",
  episodeTitle: "第1話",
  expiresAt: "",
  note: "",
  publicId,
  revokedAt: "",
  seriesPublicId: "SERIES001",
  seriesTitle: "シリーズ",
  status: "active",
  userEmail: "reader@example.com",
  userName: "Reader",
  userPublicId: "USER001",
});

describe("listAccessTickets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("passes the cursor token and the limit through and returns the tokens of the response", async () => {
    mockListAccessTickets.mockResolvedValue({
      nextToken: "next-page",
      previousToken: "previous-page",
      tickets: [],
    });

    const { listAccessTickets } = await import("./access-ticket");
    const result = await listAccessTickets("TENANT001", {
      limit: 20,
      token: "current-page",
    });

    expect(mockListAccessTickets).toHaveBeenCalledWith(
      {
        activeOnly: false,
        episodePublicId: "",
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "current-page",
        userPublicId: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({
      nextToken: "next-page",
      ok: true,
      previousToken: "previous-page",
    });
  });

  it("fetches the first page with an empty token", async () => {
    mockListAccessTickets.mockResolvedValue({ tickets: [] });

    const { listAccessTickets } = await import("./access-ticket");
    const result = await listAccessTickets("TENANT001");

    expect(mockListAccessTickets).toHaveBeenCalledWith(
      {
        activeOnly: false,
        episodePublicId: "",
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "",
        userPublicId: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    // トークン未指定の応答でも、呼び出し側が分岐せずに済むよう空文字へそろえる。
    expect(result).toMatchObject({
      nextToken: "",
      ok: true,
      previousToken: "",
    });
  });

  it("passes activeOnly together with the pagination", async () => {
    mockListAccessTickets.mockResolvedValue({ tickets: [] });

    const { listAccessTickets } = await import("./access-ticket");
    await listAccessTickets("TENANT001", {
      activeOnly: true,
      episodePublicId: "EPISODE001",
      token: "current-page",
      userPublicId: "USER001",
    });

    expect(mockListAccessTickets).toHaveBeenCalledWith(
      {
        activeOnly: true,
        episodePublicId: "EPISODE001",
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "current-page",
        userPublicId: "USER001",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("returns the keyset order of the server without re-sorting it", async () => {
    mockListAccessTickets.mockResolvedValue({
      tickets: [
        ticket("TICKET002", "2026-04-01T00:00:00Z"),
        ticket("TICKET001", "2026-06-01T00:00:00Z"),
      ],
    });

    const { listAccessTickets } = await import("./access-ticket");
    const result = await listAccessTickets("TENANT001");

    expect(result.tickets.map((item) => item.publicId)).toEqual([
      "TICKET002",
      "TICKET001",
    ]);
  });

  it("returns a result with no token when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listAccessTickets } = await import("./access-ticket");
    const result = await listAccessTickets("TENANT001", {
      token: "current-page",
    });

    expect(mockListAccessTickets).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      nextToken: "",
      ok: false,
      previousToken: "",
      tickets: [],
    });
  });

  it("returns a result with no token when the fetch fails", async () => {
    mockListAccessTickets.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listAccessTickets } = await import("./access-ticket");
    const result = await listAccessTickets("TENANT001", {
      token: "current-page",
    });

    expect(result).toMatchObject({
      nextToken: "",
      ok: false,
      previousToken: "",
      tickets: [],
    });
  });
});
