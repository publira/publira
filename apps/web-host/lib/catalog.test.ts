import { Code, ConnectError } from "@publira/api-client/errors";
import { EpisodeAccess } from "@publira/api-client/public/catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getEpisodeDetail,
  getEpisodeViewer,
  isPublicEpisodeBody,
  toEpisodeAccessState,
} from "./catalog";

const { mockGetEpisodeDetail } = vi.hoisted(() => ({
  mockGetEpisodeDetail: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    catalog: {
      getEpisodeDetail: mockGetEpisodeDetail,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("toEpisodeAccessState", () => {
  it("Copy RPC enum as is", () => {
    expect(toEpisodeAccessState(EpisodeAccess.FREE, 0)).toBe("free");
    expect(toEpisodeAccessState(EpisodeAccess.LOCKED, 500)).toBe("locked");
    expect(toEpisodeAccessState(EpisodeAccess.ENTITLED, 500)).toBe("entitled");
  });

  it("If not specified, fall back to price", () => {
    expect(toEpisodeAccessState(EpisodeAccess.UNSPECIFIED, 0)).toBe("free");
    expect(toEpisodeAccessState(undefined, 500)).toBe("locked");
  });

  it("Publicly display only the free text", () => {
    expect(isPublicEpisodeBody("free")).toBe(true);
    expect(isPublicEpisodeBody("locked")).toBe(false);
    expect(isPublicEpisodeBody("entitled")).toBe(false);
  });
});

describe("catalog.getEpisodeDetail", () => {
  beforeEach(() => {
    mockGetEpisodeDetail.mockReset();
  });

  it("Format and return episode details and images", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      access: EpisodeAccess.LOCKED,
      episode: {
        orderIndex: 2,
        price: 300,
        publicId: "EP_001",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 72,
        scheduledAt: "",
        status: "published",
        title: "第2話",
      },
      images: [
        {
          contentType: "image/png",
          displayOrder: 2,
          fileSizeBytes: 2048,
          height: 1800,
          id: "img_2",
          imageUrl: "https://cdn.example/img2.png",
          width: 1200,
        },
        {
          contentType: "image/png",
          displayOrder: 1,
          fileSizeBytes: 1024,
          height: 1800,
          id: "img_1",
          imageUrl: "https://cdn.example/img1.png",
          width: 1200,
        },
      ],
      series: {
        publicId: "SERIES_001",
        title: "シリーズタイトル",
      },
    });

    const result = await getEpisodeDetail(
      "TENANT_001",
      "SERIES_001",
      "EP_001",
      "ja"
    );

    expect(mockGetEpisodeDetail).toHaveBeenCalledWith({
      publicId: "EP_001",
      tenant: { tenantId: "TENANT_001" },
    });
    const detail = result.ok ? result.value : null;
    expect(detail?.series).toEqual({
      publicId: "SERIES_001",
      title: "シリーズタイトル",
    });
    expect(detail?.episode.title).toBe("第2話");
    expect(detail?.access).toBe("locked");
    expect(detail?.images.map((image) => image.id)).toEqual(["img_1", "img_2"]);
    expect(detail?.images[0]?.fileSizeBytes).toBe(1024);
  });

  it("null if episode is missing", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      episode: undefined,
      images: [],
      series: {
        publicId: "SERIES_001",
        title: "シリーズタイトル",
      },
    });

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001", "ja")
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("null if the series_id of the URL and the response do not match", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      episode: {
        orderIndex: 1,
        price: 0,
        publicId: "EP_001",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 0,
        scheduledAt: "",
        status: "published",
        title: "第1話",
      },
      images: [],
      series: {
        publicId: "SERIES_OTHER",
        title: "別シリーズ",
      },
    });

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001", "ja")
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("null if the API returns not_found", async () => {
    mockGetEpisodeDetail.mockRejectedValueOnce(
      new ConnectError("episode not found", Code.NotFound)
    );

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001", "ja")
    ).resolves.toEqual({ ok: true, value: null });
  });

  // `"use cache"` re-creates a thrown error from name + message, dropping
  // `code`; classification has to survive on the message prefix alone.
  it("ConnectError regenerated at cache boundaries will also be null", async () => {
    const rehydrated = new Error("[not_found] episode not found");
    rehydrated.name = "ConnectError";
    mockGetEpisodeDetail.mockRejectedValueOnce(rehydrated);

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001", "ja")
    ).resolves.toEqual({ ok: true, value: null });
  });

  // Another tenant's episode comes back as permission_denied, not not_found.
  it("null if the API returns permission_denied", async () => {
    mockGetEpisodeDetail.mockRejectedValueOnce(
      new ConnectError("episode is not published", Code.PermissionDenied)
    );

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001", "ja")
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("Remove leading and trailing spaces from the identifier and pass it to the API to determine affiliation", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      access: EpisodeAccess.FREE,
      episode: {
        orderIndex: 1,
        price: 0,
        publicId: "EP_001",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 0,
        scheduledAt: "",
        status: "published",
        title: "第1話",
      },
      images: [],
      series: { publicId: "SERIES_001", title: "シリーズタイトル" },
    });

    const result = await getEpisodeDetail(
      " TENANT_001 ",
      " SERIES_001 ",
      " EP_001 ",
      "ja"
    );

    expect(mockGetEpisodeDetail).toHaveBeenCalledWith({
      publicId: "EP_001",
      tenant: { tenantId: "TENANT_001" },
    });
    expect(result.ok && result.value?.episode.title).toBe("第1話");
  });

  // A `"use cache"` function must not throw: the fill would fail the whole
  // request instead of reaching the awaiting page (#672).
  it("Errors other than not_found are not thrown and return a failure value.", async () => {
    mockGetEpisodeDetail.mockRejectedValueOnce(
      new ConnectError("connect ECONNREFUSED", Code.Unavailable)
    );

    await expect(
      getEpisodeDetail("TENANT_001", "SERIES_001", "EP_001", "ja")
    ).resolves.toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
    });
  });
});

describe("catalog.getEpisodeViewer", () => {
  beforeEach(() => {
    mockGetEpisodeDetail.mockReset();
  });

  it("If there is no session, return locked without RPC", async () => {
    await expect(
      getEpisodeViewer("TENANT_001", "SERIES_001", "EP_010", "", "ja")
    ).resolves.toEqual({
      ok: true,
      value: { access: "locked", images: [] },
    });
    expect(mockGetEpisodeDetail).not.toHaveBeenCalled();
  });

  it("Valid ticket returns entitled image with session", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      access: EpisodeAccess.ENTITLED,
      episode: {
        orderIndex: 10,
        price: 500,
        publicId: "EP_010",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 72,
        scheduledAt: "",
        status: "published",
        title: "第10話",
      },
      images: [
        {
          contentType: "image/png",
          displayOrder: 1,
          fileSizeBytes: 1024,
          height: 1800,
          id: "img_1",
          imageUrl: "https://cdn.example/img1.png",
          width: 1200,
        },
      ],
      series: { publicId: "SERIES_001", title: "シリーズタイトル" },
    });

    const result = await getEpisodeViewer(
      "TENANT_001",
      "SERIES_001",
      "EP_010",
      "session-token",
      "ja"
    );

    expect(mockGetEpisodeDetail).toHaveBeenCalledWith(
      {
        publicId: "EP_010",
        tenant: { tenantId: "TENANT_001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      ok: true,
      value: {
        access: "entitled",
        images: [
          {
            contentType: "image/png",
            displayOrder: 1,
            fileSizeBytes: 1024,
            height: 1800,
            id: "img_1",
            imageUrl: "https://cdn.example/img1.png",
            width: 1200,
          },
        ],
      },
    });
  });

  it("Locked if you are logged in but do not have permissions", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      access: EpisodeAccess.LOCKED,
      episode: {
        orderIndex: 10,
        price: 500,
        publicId: "EP_010",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 72,
        scheduledAt: "",
        status: "published",
        title: "第10話",
      },
      images: [],
      series: { publicId: "SERIES_001", title: "シリーズタイトル" },
    });

    await expect(
      getEpisodeViewer(
        "TENANT_001",
        "SERIES_001",
        "EP_010",
        "session-token",
        "ja"
      )
    ).resolves.toEqual({
      ok: true,
      value: { access: "locked", images: [] },
    });
  });

  it("permission_denied should be locked", async () => {
    mockGetEpisodeDetail.mockRejectedValueOnce(
      new ConnectError("episode is not published", Code.PermissionDenied)
    );

    await expect(
      getEpisodeViewer(
        "TENANT_001",
        "SERIES_001",
        "EP_010",
        "session-token",
        "ja"
      )
    ).resolves.toEqual({
      ok: true,
      value: { access: "locked", images: [] },
    });
  });

  it("not_found is null", async () => {
    mockGetEpisodeDetail.mockRejectedValueOnce(
      new ConnectError("episode not found", Code.NotFound)
    );

    await expect(
      getEpisodeViewer(
        "TENANT_001",
        "SERIES_001",
        "EP_010",
        "session-token",
        "ja"
      )
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("null if the series_id of the URL and the response do not match", async () => {
    mockGetEpisodeDetail.mockResolvedValueOnce({
      access: EpisodeAccess.ENTITLED,
      episode: {
        orderIndex: 10,
        price: 500,
        publicId: "EP_010",
        publishedAt: "2026-03-26T00:00:00Z",
        readingPeriodHours: 72,
        scheduledAt: "",
        status: "published",
        title: "第10話",
      },
      images: [],
      series: { publicId: "SERIES_OTHER", title: "別シリーズ" },
    });

    await expect(
      getEpisodeViewer(
        "TENANT_001",
        "SERIES_001",
        "EP_010",
        "session-token",
        "ja"
      )
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("Errors other than not_found are not thrown and return a failure value.", async () => {
    mockGetEpisodeDetail.mockRejectedValueOnce(
      new ConnectError("connect ECONNREFUSED", Code.Unavailable)
    );

    await expect(
      getEpisodeViewer(
        "TENANT_001",
        "SERIES_001",
        "EP_010",
        "session-token",
        "ja"
      )
    ).resolves.toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
    });
  });
});
