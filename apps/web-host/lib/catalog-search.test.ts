import { Code, ConnectError } from "@publira/api-client/errors";
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
          creators: [{ name: "Author A", publicId: "AUTH_A" }],
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
      limit: 12,
      query: "Series",
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
            creatorNames: ["Author A"],
            creators: [
              {
                iconImageUrl: "",
                name: "Author A",
                profileText: "",
                publicId: "AUTH_A",
              },
            ],
            eyeCatchImageUpdatedAt: undefined,
            eyeCatchImageVariants: undefined,
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
      limit: 20,
      query: "Seed",
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
