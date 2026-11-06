import { Code, ConnectError } from "@publira/api-client/errors";
import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SeriesImportPlan } from "./series-import-manifest";

const {
  mockCreateEpisode,
  mockCreateSeries,
  mockGetSeriesForTenant,
  mockUpdateEpisodePublishSchedule,
  mockUploadEpisodePages,
} = vi.hoisted(() => ({
  mockCreateEpisode: vi.fn(),
  mockCreateSeries: vi.fn(),
  mockGetSeriesForTenant: vi.fn(),
  mockUpdateEpisodePublishSchedule: vi.fn(),
  mockUploadEpisodePages: vi.fn(),
}));

vi.mock("./episode", () => ({
  createEpisode: mockCreateEpisode,
  updateEpisodePublishSchedule: mockUpdateEpisodePublishSchedule,
  uploadEpisodePages: mockUploadEpisodePages,
}));

vi.mock("./series", () => ({
  createSeries: mockCreateSeries,
  getSeriesForTenant: mockGetSeriesForTenant,
}));

vi.mock("./messages", () => ({
  getMessagesFor: () => Promise.resolve((key: string) => key),
}));

const { batchSeriesImportPages, runSeriesImport } =
  await import("./series-import");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const zip = zipSync({
  "ep01/001.png": strToU8("one"),
  "ep01/002.png": strToU8("two"),
  "ep02/001.webp": strToU8("three"),
});

const episodes: SeriesImportPlan["episodes"] = [
  {
    pages: [
      { bytes: 3, path: "ep01/002.png" },
      { bytes: 3, path: "ep01/001.png" },
    ],
    price: 0,
    scheduledAt: "",
    title: "Episode 1",
  },
  {
    pages: [{ bytes: 5, path: "ep02/001.webp" }],
    price: 500,
    scheduledAt: "2030-01-01T00:00:00Z",
    title: "Episode 2",
  },
];

const newSeriesPlan: SeriesImportPlan = {
  episodes,
  target: {
    kind: "new",
    locale: "ja",
    readingDirection: "ltr",
    synopsis: "About it",
    title: "A series",
  },
};

const run = (plan: SeriesImportPlan) =>
  runSeriesImport(plan, {
    currency: "JPY",
    locale: "en",
    tenantId: TENANT_ID,
    zip,
  });

describe("runSeriesImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSeries.mockResolvedValue({
      ok: true,
      series: { id: "series-id", publicId: "SERIES001", readingPeriodHours: 0 },
    });
    mockCreateEpisode.mockImplementation(({ title }: { title: string }) =>
      Promise.resolve({
        episode: { id: `id-${title}`, publicId: `public-${title}` },
        ok: true,
      })
    );
    mockUploadEpisodePages.mockResolvedValue({ ok: true, uploadedCount: 1 });
    mockUpdateEpisodePublishSchedule.mockResolvedValue({ ok: true });
  });

  it("creates the series, then each episode with its pages in order", async () => {
    const result = await run(newSeriesPlan);

    expect(mockCreateSeries).toHaveBeenCalledOnce();
    expect(mockCreateSeries.mock.calls[0]?.[0]).toMatchObject({
      isPublished: false,
      readingDirection: "ltr",
      synopsis: "About it",
      tenantId: TENANT_ID,
      title: "A series",
      translationLocale: "ja",
    });

    expect(mockCreateEpisode.mock.calls.map(([input]) => input)).toMatchObject([
      {
        currency: "JPY",
        price: 0,
        publishAt: "",
        seriesId: "series-id",
        title: "Episode 1",
        translationLocale: "ja",
      },
      { price: 500, publishAt: "", title: "Episode 2" },
    ]);

    const [firstUpload] = mockUploadEpisodePages.mock.calls[0] ?? [];

    expect(firstUpload.episodeId).toBe("id-Episode 1");
    expect(
      firstUpload.pages.map((file: File) => [file.name, file.type])
    ).toEqual([
      ["002.png", "image/png"],
      ["001.png", "image/png"],
    ]);
    expect(await firstUpload.pages[0].text()).toBe("two");

    const [secondUpload] = mockUploadEpisodePages.mock.calls[1] ?? [];

    expect(secondUpload.pages[0].type).toBe("image/webp");

    expect(result).toEqual({
      ok: true,
      rows: [
        {
          episodePublicId: "public-Episode 1",
          pageCount: 2,
          position: 1,
          status: "imported",
          title: "Episode 1",
        },
        {
          episodePublicId: "public-Episode 2",
          pageCount: 1,
          position: 2,
          status: "imported",
          title: "Episode 2",
        },
      ],
      seriesPublicId: "SERIES001",
    });
  });

  it("gives an episode its publication time only once every page is in", async () => {
    await run(newSeriesPlan);

    expect(mockUpdateEpisodePublishSchedule).toHaveBeenCalledOnce();
    expect(mockUpdateEpisodePublishSchedule.mock.calls[0]?.[0]).toEqual({
      episodeId: "id-Episode 2",
      publishAt: "2030-01-01T00:00:00Z",
      tenantId: TENANT_ID,
    });

    const [lastUpload] =
      mockUploadEpisodePages.mock.invocationCallOrder.slice(-1);

    const [scheduled] =
      mockUpdateEpisodePublishSchedule.mock.invocationCallOrder;

    expect(scheduled).toBeGreaterThan(lastUpload ?? Number.POSITIVE_INFINITY);
  });

  it("leaves an episode a draft when its pages do not all arrive", async () => {
    mockUploadEpisodePages
      .mockResolvedValueOnce({ ok: true, uploadedCount: 2 })
      .mockResolvedValueOnce({ message: "Storage is down.", ok: false });

    await run(newSeriesPlan);

    expect(mockUpdateEpisodePublishSchedule).not.toHaveBeenCalled();
  });

  it("names the episode whose publication time could not be set", async () => {
    mockUpdateEpisodePublishSchedule.mockResolvedValue({
      message: "Could not schedule.",
      ok: false,
    });

    expect(await run(newSeriesPlan)).toMatchObject({
      rows: [
        { status: "imported" },
        {
          episodePublicId: "public-Episode 2",
          message: "Could not schedule.",
          status: "failed",
        },
      ],
    });
  });

  it("appends to an existing series, keeping its reading period", async () => {
    mockGetSeriesForTenant.mockResolvedValue({
      ok: true,
      series: {
        id: "existing-id",
        publicId: "SERIES002",
        readingPeriodHours: 72,
      },
    });

    const result = await run({
      episodes,
      target: { kind: "existing", publicId: "SERIES002" },
    });

    expect(mockCreateSeries).not.toHaveBeenCalled();
    expect(mockCreateEpisode.mock.calls[0]?.[0]).toMatchObject({
      readingPeriodHours: 72,
      seriesId: "existing-id",
      translationLocale: undefined,
    });
    expect(result).toMatchObject({ ok: true, seriesPublicId: "SERIES002" });
  });

  it("creates nothing when the series cannot be had", async () => {
    mockGetSeriesForTenant.mockResolvedValue({ notFound: true, ok: false });

    const result = await run({
      episodes,
      target: { kind: "existing", publicId: "NOPE" },
    });

    expect(result).toEqual({ notFound: true, ok: false });
    expect(mockCreateEpisode).not.toHaveBeenCalled();
  });

  it("stops at an episode that cannot be created", async () => {
    mockCreateEpisode.mockResolvedValueOnce({
      message: "No such currency.",
      ok: false,
    });

    expect(await run(newSeriesPlan)).toMatchObject({
      rows: [
        { message: "No such currency.", status: "failed", title: "Episode 1" },
        { status: "not_started", title: "Episode 2" },
      ],
    });
    expect(mockCreateEpisode).toHaveBeenCalledOnce();
  });

  it("names the episode left behind by an upload that failed", async () => {
    mockUploadEpisodePages
      .mockResolvedValueOnce({ ok: true, uploadedCount: 2 })
      .mockResolvedValueOnce({ message: "Storage is down.", ok: false });

    expect(await run(newSeriesPlan)).toMatchObject({
      rows: [
        { status: "imported" },
        {
          episodePublicId: "public-Episode 2",
          message: "Storage is down.",
          status: "failed",
        },
      ],
    });
  });

  it("keeps the rows, and the episode left behind, when an upload throws", async () => {
    mockUploadEpisodePages
      .mockResolvedValueOnce({ ok: true, uploadedCount: 2 })
      .mockRejectedValueOnce(new ConnectError("expired", Code.Unauthenticated));

    expect(await run(newSeriesPlan)).toMatchObject({
      rows: [
        { status: "imported" },
        {
          episodePublicId: "public-Episode 2",
          message: "errors.rpc.unauthenticated",
          status: "failed",
        },
      ],
    });
  });

  it("names no episode when creating it throws", async () => {
    mockCreateEpisode.mockRejectedValueOnce(new Error("broken"));

    const result = await run(newSeriesPlan);

    expect(result).toMatchObject({
      rows: [
        { message: "admin.series.import.episode_failed", status: "failed" },
        { status: "not_started" },
      ],
    });
    expect(result.ok && result.rows[0]?.episodePublicId).toBeUndefined();
  });
});

const pages = (...sizes: number[]) =>
  sizes.map((bytes, index) => ({ bytes, path: `${index}.png` }));

describe("batchSeriesImportPages", () => {
  it("keeps pages in order and every run within the limit", () => {
    expect(
      batchSeriesImportPages(pages(6, 4, 1, 10, 2), 10).map((batch) =>
        batch.map((page) => page.bytes)
      )
    ).toEqual([[6, 4], [1], [10], [2]]);
  });

  it("answers no runs for no pages", () => {
    expect(batchSeriesImportPages([])).toEqual([]);
  });
});
