import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSaveReadingPosition } = vi.hoisted(() => ({
  mockSaveReadingPosition: vi.fn(),
}));

vi.mock("#lib/reading-position", () => ({
  saveReadingPosition: mockSaveReadingPosition,
}));

const { POST } = await import("./route");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SERIES_ID = "SR_001";
const EPISODE_ID = "EP_001";

const SAME_ORIGIN_HEADERS = {
  host: "shop.example.test",
  origin: "https://shop.example.test",
};

const beacon = (
  body: string | null = JSON.stringify({ pageIndex: 11 }),
  headers = SAME_ORIGIN_HEADERS
) =>
  new Request(
    `https://shop.example.test/api/v1/series/${SERIES_ID}/episodes/${EPISODE_ID}/reading-position`,
    { body, headers, method: "POST" }
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

describe("POST /api/v1/series/[series_id]/episodes/[episode_id]/reading-position", () => {
  beforeEach(() => {
    mockSaveReadingPosition.mockReturnValue(Promise.resolve());
  });

  it("takes the page from the body and everything else from the path", async () => {
    const response = await POST(beacon(), params());

    expect(response.status).toBe(204);
    expect(mockSaveReadingPosition).toHaveBeenCalledWith({
      episodePublicId: EPISODE_ID,
      pageIndex: 11,
      tenantId: TENANT_ID,
    });
  });

  it("saves the first page, which is not the same as saving nothing", async () => {
    await POST(beacon(JSON.stringify({ pageIndex: 0 })), params());

    expect(mockSaveReadingPosition).toHaveBeenCalledWith({
      episodePublicId: EPISODE_ID,
      pageIndex: 0,
      tenantId: TENANT_ID,
    });
  });

  it("saves nothing for a beacon from another origin", async () => {
    const response = await POST(
      beacon(undefined, {
        host: "shop.example.test",
        origin: "https://evil.example",
      }),
      params()
    );

    expect(response.status).toBe(403);
    expect(mockSaveReadingPosition).not.toHaveBeenCalled();
  });

  it("saves nothing for a tenant id the proxy would never rewrite", async () => {
    const response = await POST(beacon(), params({ tenantId: "not-a-tenant" }));

    expect(response.status).toBe(400);
    expect(mockSaveReadingPosition).not.toHaveBeenCalled();
  });

  it("saves nothing when the path names no episode", async () => {
    const response = await POST(beacon(), params({ episodeId: "  " }));

    expect(response.status).toBe(400);
    expect(mockSaveReadingPosition).not.toHaveBeenCalled();
  });

  it("saves nothing when the path names no series", async () => {
    const response = await POST(beacon(), params({ seriesId: "  " }));

    expect(response.status).toBe(400);
    expect(mockSaveReadingPosition).not.toHaveBeenCalled();
  });

  it("saves nothing for a body that is not JSON", async () => {
    const response = await POST(beacon("not json"), params());

    expect(response.status).toBe(400);
    expect(mockSaveReadingPosition).not.toHaveBeenCalled();
  });

  it("saves nothing for a page that is not a whole page number", async () => {
    const response = await POST(
      beacon(JSON.stringify({ pageIndex: 1.5 })),
      params()
    );

    expect(response.status).toBe(400);
    expect(mockSaveReadingPosition).not.toHaveBeenCalled();
  });

  it("saves nothing for a page before the first one", async () => {
    const response = await POST(
      beacon(JSON.stringify({ pageIndex: -1 })),
      params()
    );

    expect(response.status).toBe(400);
    expect(mockSaveReadingPosition).not.toHaveBeenCalled();
  });
});
