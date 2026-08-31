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

  it("匿名の読者に actor を採番し、Cookie に残して API へ転送する", async () => {
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
    // 生イベントの保持期間より長く、放置された識別子は失効する。
    expect(written.maxAge).toBe(180 * 24 * 60 * 60);

    expect(mockGetEpisodeDetail).toHaveBeenCalledWith(
      { publicId: "EP_001", tenant: { tenantId: TENANT_ID } },
      { headers: { Cookie: `publira_aid=${written.value}` } }
    );
  });

  it("すでに持っている actor は採番し直さない", async () => {
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
    "API が受け付けない値 %s は転送せず採番し直す",
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

  it("ログイン中は Bearer だけを送り、匿名 actor を作らない", async () => {
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

  it("RPC が失敗しても読者のページには影響しない", async () => {
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
