import { Code, ConnectError } from "@publira/api-client/errors";
import { ClientSurface } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  findPublishedTagBySlug,
  getEpisodeDetail,
  getEpisodeViewer,
  getSeriesDetail,
  listPublishedGenres,
  listPublishedSeries,
  listRankedSeries,
  listRecommendedSeries,
  listRelatedSeries,
  searchPublishedLabels,
  searchPublishedSeries,
} from "./catalog";
import {
  getPublishedCreatorDetail,
  listPublishedCreators,
  searchPublishedCreators,
} from "./creators";
import { getPublishedLabelDetail } from "./labels";

const catalog = vi.hoisted(() => ({
  getEpisodeDetail: vi.fn(),
  getPublishedCreatorDetail: vi.fn(),
  getPublishedLabelDetail: vi.fn(),
  getSeriesDetail: vi.fn(),
  listPublishedCreators: vi.fn(),
  listPublishedGenres: vi.fn(),
  listPublishedSeries: vi.fn(),
  listPublishedTags: vi.fn(),
  listRankedSeries: vi.fn(),
  listRecommendedSeries: vi.fn(),
  listRelatedSeries: vi.fn(),
  searchPublishedCreators: vi.fn(),
  searchPublishedLabels: vi.fn(),
  searchPublishedSeries: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: { catalog },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { authorization: `Bearer ${sessionId}` },
  }),
}));

describe("storefront catalog reads", () => {
  beforeEach(() => {
    for (const rpc of Object.values(catalog)) {
      rpc.mockReset();
      rpc.mockResolvedValue({});
    }
  });

  it.each([
    [
      "listPublishedSeries",
      () => listPublishedSeries("TENANT_1", { limit: 6, locale: "en" }),
    ],
    ["listPublishedGenres", () => listPublishedGenres("TENANT_1", "en")],
    [
      "listPublishedTags",
      () => findPublishedTagBySlug("TENANT_1", "action", "en"),
    ],
    [
      "listRecommendedSeries",
      () => listRecommendedSeries("TENANT_1", { locale: "en" }),
    ],
    [
      "listRelatedSeries",
      () =>
        listRelatedSeries("TENANT_1", {
          locale: "en",
          seriesPublicId: "SERIES_1",
        }),
    ],
    [
      "listRankedSeries",
      () => listRankedSeries("TENANT_1", { locale: "en", period: "daily" }),
    ],
    [
      "searchPublishedSeries",
      () =>
        searchPublishedSeries("TENANT_1", { locale: "en", query: "Series" }),
    ],
    [
      "searchPublishedLabels",
      () => searchPublishedLabels("TENANT_1", { locale: "en", query: "Label" }),
    ],
    ["getSeriesDetail", () => getSeriesDetail("TENANT_1", "SERIES_1", "en")],
    [
      "getEpisodeDetail",
      () => getEpisodeDetail("TENANT_1", "SERIES_1", "EP_1", "en"),
    ],
    [
      "listPublishedCreators",
      () => listPublishedCreators("TENANT_1", { locale: "en" }),
    ],
    [
      "searchPublishedCreators",
      () =>
        searchPublishedCreators("TENANT_1", { locale: "en", query: "Creator" }),
    ],
    [
      "getPublishedCreatorDetail",
      () =>
        getPublishedCreatorDetail("TENANT_1", "CREATOR_1", { locale: "en" }),
    ],
    [
      "getPublishedLabelDetail",
      () => getPublishedLabelDetail("TENANT_1", "LABEL_1", { locale: "en" }),
    ],
  ] as const)("%s names the web surface", async (rpc, read) => {
    await read();

    expect(catalog[rpc].mock.calls[0]?.[0]).toMatchObject({
      surface: ClientSurface.WEB,
    });
  });

  it("names the web surface on the signed-in episode body read", async () => {
    catalog.getEpisodeDetail.mockResolvedValueOnce({
      series: { publicId: "SERIES_1" },
    });

    await getEpisodeViewer("TENANT_1", "SERIES_1", "EP_1", "SESSION_1", "en");

    expect(catalog.getEpisodeDetail).toHaveBeenCalledWith(
      expect.objectContaining({ surface: ClientSurface.WEB }),
      expect.anything()
    );
  });

  /**
   * A series kept to the app answers `not_found` to the web surface, and the
   * page turns the null into a 404 on a URL a reader kept.
   */
  it("reads a series the storefront may not show as missing", async () => {
    catalog.getSeriesDetail.mockRejectedValueOnce(
      new ConnectError("series not found", Code.NotFound)
    );

    await expect(
      getSeriesDetail("TENANT_1", "SERIES_1", "en")
    ).resolves.toEqual({ ok: true, value: null });
  });
});
