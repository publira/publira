import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordContentView, VIEW_ACTOR_COOKIE_NAME } from "./view-events";

const {
  mockCookies,
  mockGetEpisodeDetail,
  mockGetSeriesDetail,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetEpisodeDetail: vi.fn(),
  mockGetSeriesDetail: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    catalog: {
      getEpisodeDetail: mockGetEpisodeDetail,
      getSeriesDetail: mockGetSeriesDetail,
    },
  },
  resolveAccessToken: mockResolveAccessToken,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STORED_ACTOR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const cookieStore = (stored?: string) => {
  const set = vi.fn();
  mockCookies.mockResolvedValue({
    get: (name: string) =>
      name === VIEW_ACTOR_COOKIE_NAME && stored !== undefined
        ? { name, value: stored }
        : undefined,
    set,
  });
  return set;
};

const forwardedHeaders = (
  rpc: ReturnType<typeof vi.fn>
): Record<string, string> => {
  const [, options] = rpc.mock.calls[0] as [
    unknown,
    { headers: Record<string, string> },
  ];
  return options.headers;
};

describe("recordContentView", () => {
  beforeEach(() => {
    mockResolveAccessToken.mockResolvedValue("");
    mockGetEpisodeDetail.mockResolvedValue({});
    mockGetSeriesDetail.mockResolvedValue({});
  });

  it("mints an actor for a signed-out reader, stores it, and forwards it", async () => {
    const set = cookieStore();

    await recordContentView({
      kind: "episode",
      publicId: "EP_001",
      tenantId: TENANT_ID,
    });

    const [written] = set.mock.calls[0] as [
      { maxAge: number; name: string; value: string },
    ];
    expect(written.name).toBe(VIEW_ACTOR_COOKIE_NAME);
    expect(written.value).toMatch(UUID_PATTERN);
    // Outlives the raw events, and expires rather than living on forever.
    expect(written.maxAge).toBe(180 * 24 * 60 * 60);

    expect(mockGetEpisodeDetail).toHaveBeenCalledWith(
      { publicId: "EP_001", tenant: { tenantId: TENANT_ID } },
      { headers: { Cookie: `publira_aid=${written.value}` } }
    );
  });

  it("keeps the actor the reader already carries", async () => {
    const set = cookieStore(STORED_ACTOR_ID);

    await recordContentView({
      kind: "series",
      publicId: "SR_001",
      tenantId: TENANT_ID,
    });

    expect(set).not.toHaveBeenCalled();
    expect(mockGetSeriesDetail).toHaveBeenCalledWith(
      { publicId: "SR_001", tenant: { tenantId: TENANT_ID } },
      { headers: { Cookie: `publira_aid=${STORED_ACTOR_ID}` } }
    );
  });

  it.each(["not-a-uuid", "00000000-0000-0000-0000-000000000000"])(
    "replaces %s, which the API would not accept, instead of forwarding it",
    async (stored) => {
      const set = cookieStore(stored);

      await recordContentView({
        kind: "series",
        publicId: "SR_001",
        tenantId: TENANT_ID,
      });

      expect(set).toHaveBeenCalledTimes(1);
      expect(forwardedHeaders(mockGetSeriesDetail).Cookie).not.toContain(
        stored
      );
    }
  );

  it("sends only the bearer for a signed-in reader, minting no actor", async () => {
    const set = cookieStore();
    mockResolveAccessToken.mockResolvedValue("header.payload.signature");

    await recordContentView({
      kind: "episode",
      publicId: "EP_001",
      tenantId: TENANT_ID,
    });

    expect(set).not.toHaveBeenCalled();
    expect(forwardedHeaders(mockGetEpisodeDetail)).toEqual({
      Authorization: "Bearer header.payload.signature",
    });
  });

  it("leaves the reader's page alone when the RPC fails", async () => {
    cookieStore(STORED_ACTOR_ID);
    mockGetEpisodeDetail.mockRejectedValue(new Error("unavailable"));

    await expect(
      recordContentView({
        kind: "episode",
        publicId: "EP_001",
        tenantId: TENANT_ID,
      })
    ).resolves.toBeUndefined();
  });
});
