import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecordEpisodeRead } = vi.hoisted(() => ({
  mockRecordEpisodeRead: vi.fn(),
}));

vi.mock("#lib/episode-reads", () => ({
  recordEpisodeRead: mockRecordEpisodeRead,
}));

const { POST } = await import("./route");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SERIES_ID = "SR_001";
const EPISODE_ID = "EP_001";

const SAME_ORIGIN_HEADERS = {
  host: "shop.example.test",
  origin: "https://shop.example.test",
};

const beacon = (headers = SAME_ORIGIN_HEADERS) =>
  new Request(
    `https://shop.example.test/api/v1/series/${SERIES_ID}/episodes/${EPISODE_ID}/read`,
    { headers, method: "POST" }
  );

const params = (overrides?: {
  episodeId?: string;
  seriesId?: string;
  tenantId?: string;
}) => ({
  params: Promise.resolve({
    episode_id: overrides?.episodeId ?? EPISODE_ID,
    series_id: overrides?.seriesId ?? SERIES_ID,
    tenant_id: overrides?.tenantId ?? TENANT_ID,
  }),
});

describe("POST /api/v1/series/[series_id]/episodes/[episode_id]/read", () => {
  beforeEach(() => {
    mockRecordEpisodeRead.mockReturnValue(Promise.resolve());
  });

  it("accepts a same-origin beacon and takes everything from the path", async () => {
    const response = await POST(beacon(), params());

    expect(response.status).toBe(204);
    expect(mockRecordEpisodeRead).toHaveBeenCalledWith({
      publicId: EPISODE_ID,
      tenantId: TENANT_ID,
    });
  });

  it("records nothing for a beacon from another origin", async () => {
    const response = await POST(
      beacon({ host: "shop.example.test", origin: "https://evil.example" }),
      params()
    );

    expect(response.status).toBe(403);
    expect(mockRecordEpisodeRead).not.toHaveBeenCalled();
  });

  it("records nothing for a tenant id the proxy would never rewrite", async () => {
    const response = await POST(beacon(), params({ tenantId: "not-a-tenant" }));

    expect(response.status).toBe(400);
    expect(mockRecordEpisodeRead).not.toHaveBeenCalled();
  });

  it("records nothing when the path names no episode", async () => {
    const response = await POST(beacon(), params({ episodeId: "  " }));

    expect(response.status).toBe(400);
    expect(mockRecordEpisodeRead).not.toHaveBeenCalled();
  });

  it("records nothing when the path names no series", async () => {
    const response = await POST(beacon(), params({ seriesId: "  " }));

    expect(response.status).toBe(400);
    expect(mockRecordEpisodeRead).not.toHaveBeenCalled();
  });
});
