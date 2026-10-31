import { Code, ConnectError } from "@publira/api-client/errors";
import { SeriesOrder } from "@publira/api-client/public/catalog";
import { ClientSurface, SeriesStatus } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { searchPublishedSeries } from "./catalog";

const { mockSearchPublishedSeries } = vi.hoisted(() => ({
  mockSearchPublishedSeries: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    catalog: {
      searchPublishedSeries: mockSearchPublishedSeries,
    },
  },
}));

describe("searchPublishedSeries", () => {
  beforeEach(() => {
    mockSearchPublishedSeries.mockReset();
  });

  it("Format and return search hits and cursor tokens", async () => {
    mockSearchPublishedSeries.mockResolvedValueOnce({
      nextToken: "NEXT",
      previousToken: "PREV",
      series: [
        {
          creators: [
            {
              name: "Creator A",
              publicId: "AUTH_A",
              role: { name: "Story", publicId: "ROLE_A" },
            },
          ],
          label: { name: "Label A", publicId: "LABEL_A" },
          publicId: "SERIES_1",
          synopsis: "Synopsis",
          title: "Series 1",
        },
      ],
    });

    const result = await searchPublishedSeries(" TENANT_1 ", {
      limit: 12,
      locale: "en",
      query: "Series",
      token: "abc",
    });

    expect(mockSearchPublishedSeries).toHaveBeenCalledWith({
      genrePublicId: "",
      hasFreeEpisodes: false,
      limit: 12,
      locale: "en",
      order: SeriesOrder.UNSPECIFIED,
      query: "Series",
      status: SeriesStatus.UNSPECIFIED,
      surface: ClientSurface.WEB,
      tenant: { tenantId: "TENANT_1" },
      token: "abc",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        nextToken: "NEXT",
        previousToken: "PREV",
        series: [
          {
            credits: [
              { name: "Creator A", publicId: "AUTH_A", roleName: "Story" },
            ],
            eyeCatchImageUpdatedAt: undefined,
            eyeCatchImageVariants: undefined,
            freeEpisodeCount: 0,
            labelName: "Label A",
            labelPublicId: "LABEL_A",
            publicId: "SERIES_1",
            synopsis: "Synopsis",
            title: "Series 1",
          },
        ],
      },
    });
  });

  it("If token is omitted, get the first page", async () => {
    mockSearchPublishedSeries.mockResolvedValueOnce({
      nextToken: "",
      previousToken: "",
      series: [],
    });

    await searchPublishedSeries("TENANT_1", { locale: "en", query: "Seed" });

    expect(mockSearchPublishedSeries).toHaveBeenCalledWith({
      genrePublicId: "",
      hasFreeEpisodes: false,
      limit: 20,
      locale: "en",
      order: SeriesOrder.UNSPECIFIED,
      query: "Seed",
      status: SeriesStatus.UNSPECIFIED,
      surface: ClientSurface.WEB,
      tenant: { tenantId: "TENANT_1" },
      token: "",
    });
  });

  it("Sends the sort and the filters a reader narrowed the search with", async () => {
    mockSearchPublishedSeries.mockResolvedValueOnce({
      nextToken: "",
      previousToken: "",
      series: [],
    });

    await searchPublishedSeries("TENANT_1", {
      genrePublicId: "GENRE123abcd",
      hasFreeEpisodes: true,
      locale: "en",
      order: "updated",
      query: "Seed",
      status: "completed",
    });

    expect(mockSearchPublishedSeries).toHaveBeenCalledWith({
      genrePublicId: "GENRE123abcd",
      hasFreeEpisodes: true,
      limit: 20,
      locale: "en",
      order: SeriesOrder.LATEST_EPISODE_AT_DESC,
      query: "Seed",
      status: SeriesStatus.COMPLETED,
      surface: ClientSurface.WEB,
      tenant: { tenantId: "TENANT_1" },
      token: "",
    });
  });

  it("If acquisition fails, return the failure value without throwing", async () => {
    mockSearchPublishedSeries.mockRejectedValueOnce(
      new ConnectError("connect ECONNREFUSED", Code.Unavailable)
    );

    await expect(
      searchPublishedSeries("TENANT_1", { locale: "en", query: "Seed" })
    ).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
  });
});
