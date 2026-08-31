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
          creators: [{ name: "著者A", publicId: "AUTH_A" }],
          label: { name: "レーベルA", publicId: "LABEL_A" },
          publicId: "SERIES_1",
          synopsis: "あらすじ",
          title: "シリーズ1",
        },
      ],
    });

    const result = await searchPublishedSeries(" TENANT_1 ", {
      limit: 12,
      locale: "ja",
      query: "シリーズ",
      token: "abc",
    });

    expect(mockSearchPublishedSeries).toHaveBeenCalledWith({
      limit: 12,
      query: "シリーズ",
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
            creatorNames: ["著者A"],
            creators: [
              {
                iconImageUrl: "",
                name: "著者A",
                profileText: "",
                publicId: "AUTH_A",
              },
            ],
            eyeCatchImageUpdatedAt: undefined,
            eyeCatchImageVariants: undefined,
            labelName: "レーベルA",
            labelPublicId: "LABEL_A",
            publicId: "SERIES_1",
            synopsis: "あらすじ",
            title: "シリーズ1",
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

    await searchPublishedSeries("TENANT_1", { locale: "ja", query: "Seed" });

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
      searchPublishedSeries("TENANT_1", { locale: "ja", query: "Seed" })
    ).resolves.toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
    });
  });
});
