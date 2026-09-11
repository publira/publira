import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPublishedCreatorDetail, listPublishedCreators } from "./creators";

const { mockGetPublishedCreatorDetail, mockListPublishedCreators } = vi.hoisted(
  () => ({
    mockGetPublishedCreatorDetail: vi.fn(),
    mockListPublishedCreators: vi.fn(),
  })
);

vi.mock("./api-client", () => ({
  apiClient: {
    catalog: {
      getPublishedCreatorDetail: mockGetPublishedCreatorDetail,
      listPublishedCreators: mockListPublishedCreators,
    },
  },
}));

describe("listPublishedCreators", () => {
  beforeEach(() => {
    mockListPublishedCreators.mockReset();
  });

  it("Format public creator and return cursor token", async () => {
    mockListPublishedCreators.mockResolvedValueOnce({
      creators: [
        {
          iconImageUrl: "/images/creators/creator-yamada",
          name: "Jane Doe",
          publicId: "CREATOR_YAMADA",
          publishedSeriesCount: 2,
        },
        {
          iconImageUrl: "",
          name: "John Smith",
          publicId: "CREATOR_SUZUKI",
          publishedSeriesCount: 1,
        },
      ],
      nextToken: "NEXT",
      previousToken: "PREV",
    });

    const result = await listPublishedCreators(" TENANT_1 ", {
      limit: 12,
      locale: "en",
      token: "abc",
    });

    expect(mockListPublishedCreators).toHaveBeenCalledWith({
      limit: 12,
      tenant: { tenantId: "TENANT_1" },
      token: "abc",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        creators: [
          {
            iconImageUrl: "/images/creators/creator-yamada",
            id: "CREATOR_YAMADA",
            name: "Jane Doe",
            seriesCount: 2,
          },
          {
            iconImageUrl: "",
            id: "CREATOR_SUZUKI",
            name: "John Smith",
            seriesCount: 1,
          },
        ],
        nextToken: "NEXT",
        previousToken: "PREV",
      },
    });
  });

  it("If token is omitted, get the first page", async () => {
    mockListPublishedCreators.mockResolvedValueOnce({
      creators: [],
      nextToken: "",
      previousToken: "",
    });

    await listPublishedCreators("TENANT_1", { locale: "en" });

    expect(mockListPublishedCreators).toHaveBeenCalledWith({
      limit: 20,
      tenant: { tenantId: "TENANT_1" },
      token: "",
    });
  });

  // A `"use cache"` function must not throw: the fill would fail the whole
  // request instead of reaching the awaiting page.
  it("If acquisition fails, return the failure value without throwing", async () => {
    mockListPublishedCreators.mockRejectedValueOnce(
      new ConnectError("connect ECONNREFUSED", Code.Unavailable)
    );

    await expect(
      listPublishedCreators("TENANT_1", { locale: "en" })
    ).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
  });
});

describe("getPublishedCreatorDetail", () => {
  beforeEach(() => {
    mockGetPublishedCreatorDetail.mockReset();
  });

  it("Return 1 page of creator details and related series", async () => {
    mockGetPublishedCreatorDetail.mockResolvedValueOnce({
      creator: {
        iconImageUrl: "/images/creators/creator-a",
        name: "Creator A",
        profileText: "Creator A profile",
        publicId: "CREATOR_A",
        publishedSeriesCount: 3,
      },
      nextToken: "NEXT_SERIES",
      previousToken: "",
      series: [
        {
          creators: [{ name: "Creator A", publicId: "CREATOR_A" }],
          eyeCatchImageVariants: [
            {
              contentType: "image/webp",
              fileSizeBytes: 1024,
              height: 1600,
              label: "portrait_1200w",
              url: "/images/series/series-1/portrait/1200",
              variantType: "portrait",
              width: 1200,
            },
          ],
          publicId: "SERIES_1",
          title: "Series 1",
        },
        { publicId: "SERIES_2", title: "Series 2" },
      ],
    });

    const result = await getPublishedCreatorDetail(
      " TENANT_1 ",
      " CREATOR_A ",
      {
        limit: 12,
        locale: "en",
        token: "",
      }
    );

    expect(mockGetPublishedCreatorDetail).toHaveBeenCalledWith({
      limit: 12,
      publicId: "CREATOR_A",
      tenant: { tenantId: "TENANT_1" },
      token: "",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        iconImageUrl: "/images/creators/creator-a",
        id: "CREATOR_A",
        name: "Creator A",
        nextToken: "NEXT_SERIES",
        previousToken: "",
        profileText: "Creator A profile",
        // The shelf on the creator page draws covers and creators, so the
        // mapper hands back the whole series item rather than a name and an id.
        series: [
          {
            creatorNames: ["Creator A"],
            creators: [
              {
                iconImageUrl: "",
                name: "Creator A",
                profileText: "",
                publicId: "CREATOR_A",
              },
            ],
            eyeCatchImageVariants: [
              {
                contentType: "image/webp",
                fileSizeBytes: 1024,
                height: 1600,
                label: "portrait_1200w",
                url: "/images/series/series-1/portrait/1200",
                variantType: "portrait",
                width: 1200,
              },
            ],
            freeEpisodeCount: 0,
            labelName: "",
            labelPublicId: "",
            publicId: "SERIES_1",
            title: "Series 1",
          },
          {
            creatorNames: [],
            creators: [],
            freeEpisodeCount: 0,
            labelName: "",
            labelPublicId: "",
            publicId: "SERIES_2",
            title: "Series 2",
          },
        ],
        seriesCount: 3,
      },
    });
  });

  it("Drop series lines without publicId", async () => {
    mockGetPublishedCreatorDetail.mockResolvedValueOnce({
      creator: {
        iconImageUrl: "",
        name: "Creator A",
        profileText: "",
        publicId: "CREATOR_A",
        publishedSeriesCount: 1,
      },
      nextToken: "",
      previousToken: "",
      series: [
        { publicId: "  ", title: "Missing entry" },
        { publicId: "SERIES_1", title: " Series 1 " },
      ],
    });

    const result = await getPublishedCreatorDetail("TENANT_1", "CREATOR_A", {
      locale: "en",
    });

    expect(
      result.ok && result.value?.series.map((series) => series.publicId)
    ).toEqual(["SERIES_1"]);
  });

  it("null if creator is missing", async () => {
    mockGetPublishedCreatorDetail.mockResolvedValueOnce({
      creator: undefined,
      nextToken: "",
      previousToken: "",
      series: [],
    });

    await expect(
      getPublishedCreatorDetail("TENANT_1", "CREATOR_A", { locale: "en" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("null if the API returns not_found", async () => {
    mockGetPublishedCreatorDetail.mockRejectedValueOnce(
      new ConnectError("creator not found", Code.NotFound)
    );

    await expect(
      getPublishedCreatorDetail("TENANT_1", "UNKNOWN_CREATOR", { locale: "en" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  // `"use cache"` re-creates a thrown error from name + message, dropping
  // `code`; classification has to survive on the message prefix alone.
  it("ConnectError regenerated at cache boundaries will also be null", async () => {
    const rehydrated = new Error("[not_found] creator not found");
    rehydrated.name = "ConnectError";
    mockGetPublishedCreatorDetail.mockRejectedValueOnce(rehydrated);

    await expect(
      getPublishedCreatorDetail("TENANT_1", "CREATOR_A", { locale: "en" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  // Another tenant's creator comes back as permission_denied, not not_found.
  it("null if the API returns permission_denied", async () => {
    mockGetPublishedCreatorDetail.mockRejectedValueOnce(
      new ConnectError("creator is not published", Code.PermissionDenied)
    );

    await expect(
      getPublishedCreatorDetail("TENANT_1", "CREATOR_A", { locale: "en" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("Errors other than not_found are not thrown and return a failure value.", async () => {
    mockGetPublishedCreatorDetail.mockRejectedValueOnce(
      new ConnectError("connect ECONNREFUSED", Code.Unavailable)
    );

    await expect(
      getPublishedCreatorDetail("TENANT_1", "CREATOR_A", { locale: "en" })
    ).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
  });
});
