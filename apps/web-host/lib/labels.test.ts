import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPublishedLabelDetail } from "./labels";

const { mockGetPublishedLabelDetail } = vi.hoisted(() => ({
  mockGetPublishedLabelDetail: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    catalog: {
      getPublishedLabelDetail: mockGetPublishedLabelDetail,
    },
  },
}));

describe("getPublishedLabelDetail", () => {
  beforeEach(() => {
    mockGetPublishedLabelDetail.mockReset();
  });

  it("Return 1 page of label details and affiliation series", async () => {
    mockGetPublishedLabelDetail.mockResolvedValueOnce({
      label: {
        name: "Label A",
        publicId: "LABEL_A",
        publishedSeriesCount: 3,
      },
      nextToken: "NEXT_SERIES",
      previousToken: "",
      series: [
        { publicId: "SERIES_1", title: "Series 1" },
        { publicId: "SERIES_2", title: "Series 2" },
      ],
    });

    const result = await getPublishedLabelDetail(" TENANT_1 ", " LABEL_A ", {
      limit: 12,
      locale: "en",
      token: "",
    });

    expect(mockGetPublishedLabelDetail).toHaveBeenCalledWith({
      limit: 12,
      publicId: "LABEL_A",
      tenant: { tenantId: "TENANT_1" },
      token: "",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        id: "LABEL_A",
        name: "Label A",
        nextToken: "NEXT_SERIES",
        previousToken: "",
        series: [
          { publicId: "SERIES_1", title: "Series 1" },
          { publicId: "SERIES_2", title: "Series 2" },
        ],
        seriesCount: 3,
      },
    });
  });

  it("Drop series lines without publicId", async () => {
    mockGetPublishedLabelDetail.mockResolvedValueOnce({
      label: {
        name: "Label A",
        publicId: "LABEL_A",
        publishedSeriesCount: 1,
      },
      nextToken: "",
      previousToken: "",
      series: [
        { publicId: "  ", title: "Missing entry" },
        { publicId: "SERIES_1", title: " Series 1 " },
      ],
    });

    const result = await getPublishedLabelDetail("TENANT_1", "LABEL_A", {
      locale: "en",
    });

    expect(result.ok && result.value?.series).toEqual([
      { publicId: "SERIES_1", title: "Series 1" },
    ]);
  });

  it("Labels with empty publicId are null", async () => {
    mockGetPublishedLabelDetail.mockResolvedValueOnce({
      label: {
        name: "Label A",
        publicId: "  ",
        publishedSeriesCount: 1,
      },
      nextToken: "",
      previousToken: "",
      series: [],
    });

    await expect(
      getPublishedLabelDetail("TENANT_1", "LABEL_A", { locale: "en" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("null if label is missing", async () => {
    mockGetPublishedLabelDetail.mockResolvedValueOnce({
      label: undefined,
      nextToken: "",
      previousToken: "",
      series: [],
    });

    await expect(
      getPublishedLabelDetail("TENANT_1", "LABEL_A", { locale: "en" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("null if the API returns not_found", async () => {
    mockGetPublishedLabelDetail.mockRejectedValueOnce(
      new ConnectError("label not found", Code.NotFound)
    );

    await expect(
      getPublishedLabelDetail("TENANT_1", "UNKNOWN_LABEL", { locale: "en" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("ConnectError regenerated at cache boundaries will also be null", async () => {
    const rehydrated = new Error("[not_found] label not found");
    rehydrated.name = "ConnectError";
    mockGetPublishedLabelDetail.mockRejectedValueOnce(rehydrated);

    await expect(
      getPublishedLabelDetail("TENANT_1", "LABEL_A", { locale: "en" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("null if the API returns permission_denied", async () => {
    mockGetPublishedLabelDetail.mockRejectedValueOnce(
      new ConnectError("label not found", Code.PermissionDenied)
    );

    await expect(
      getPublishedLabelDetail("TENANT_1", "LABEL_A", { locale: "en" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("Errors other than not_found are not thrown and return a failure value.", async () => {
    mockGetPublishedLabelDetail.mockRejectedValueOnce(
      new ConnectError("connect ECONNREFUSED", Code.Unavailable)
    );

    await expect(
      getPublishedLabelDetail("TENANT_1", "LABEL_A", { locale: "en" })
    ).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
  });
});
