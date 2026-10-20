import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyAdminPageSession } = vi.hoisted(() => ({
  mockVerifyAdminPageSession: vi.fn(() =>
    Promise.resolve({ locale: "en" as const, tenantId: "TENANT001" })
  ),
}));

vi.mock("./admin-page-session", () => ({
  verifyAdminPageSession: mockVerifyAdminPageSession,
}));

const {
  mockCacheLife,
  mockCacheTag,
  mockCreateEpisodeCampaignPrice,
  mockCreateSeriesCampaignPrices,
  mockDeleteEpisodeCampaignPrice,
  mockGetAccessToken,
  mockListEpisodeCampaignPrices,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockCreateEpisodeCampaignPrice: vi.fn(),
  mockCreateSeriesCampaignPrices: vi.fn(),
  mockDeleteEpisodeCampaignPrice: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockListEpisodeCampaignPrices: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    series: {
      createEpisodeCampaignPrice: mockCreateEpisodeCampaignPrice,
      createSeriesCampaignPrices: mockCreateSeriesCampaignPrices,
      deleteEpisodeCampaignPrice: mockDeleteEpisodeCampaignPrice,
      listEpisodeCampaignPrices: mockListEpisodeCampaignPrices,
    },
  },
  withServiceHeaders: () => ({
    headers: { Authorization: "Bearer service-token" },
  }),
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

/** The same failure, with the field the API names as the one it refused. */
const invalidField = (field: string) =>
  new ConnectError("invalid", Code.InvalidArgument, undefined, [
    { desc: BadRequestSchema, value: { fieldViolations: [{ field }] } },
  ]);

const campaignPrice = (
  id: string,
  price: number,
  startsAt: string,
  endsAt: string
) => ({
  createdAt: "2026-10-01T00:00:00Z",
  endsAt,
  episodeId: "EPISODE-ID",
  episodePublicId: "EPISODE001",
  episodeTitle: "Chapter One",
  id,
  price,
  publicId: `${id}-PUBLIC`,
  seriesId: "SERIES-ID",
  seriesPublicId: "SERIES001",
  startsAt,
});

const createInput = {
  currency: "JPY",
  endsAt: "2026-10-11T00:00:00Z",
  episodeId: "EPISODE-ID",
  price: 300,
  startsAt: "2026-10-10T00:00:00Z",
  tenantId: "TENANT001",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("listEpisodeCampaignPrices", () => {
  it("reads every page of one episode's campaigns with the service credential", async () => {
    mockListEpisodeCampaignPrices
      .mockResolvedValueOnce({
        campaignPrices: [
          campaignPrice(
            "CAMPAIGN2",
            300,
            "2026-10-10T00:00:00Z",
            "2026-10-11T00:00:00Z"
          ),
        ],
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        campaignPrices: [
          campaignPrice(
            "CAMPAIGN1",
            250,
            "2026-10-01T00:00:00Z",
            "2026-10-02T00:00:00Z"
          ),
        ],
        nextToken: "",
      });

    const { listEpisodeCampaignPrices } =
      await import("./episode-campaign-price");
    const result = await listEpisodeCampaignPrices({ episodeId: "EPISODE-ID" });

    expect(mockListEpisodeCampaignPrices).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        scope: { case: "episodeId", value: "EPISODE-ID" },
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer service-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "episode-campaign-prices-TENANT001"
    );
    expect(mockCacheTag).toHaveBeenCalledWith("episodes-TENANT001");
    // Written through the Admin API without this app, a campaign reaches the
    // list once the entry is a minute old.
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
    expect(result).toEqual({
      campaignPrices: [
        {
          endsAt: "2026-10-11T00:00:00Z",
          episodeId: "EPISODE-ID",
          episodePublicId: "EPISODE001",
          episodeTitle: "Chapter One",
          id: "CAMPAIGN2",
          price: 300,
          startsAt: "2026-10-10T00:00:00Z",
        },
        {
          endsAt: "2026-10-02T00:00:00Z",
          episodeId: "EPISODE-ID",
          episodePublicId: "EPISODE001",
          episodeTitle: "Chapter One",
          id: "CAMPAIGN1",
          price: 250,
          startsAt: "2026-10-01T00:00:00Z",
        },
      ],
      ok: true,
    });
  });

  it("reports a failed read instead of an empty list", async () => {
    mockListEpisodeCampaignPrices.mockRejectedValue(
      new ConnectError("down", Code.Unavailable)
    );

    const { listEpisodeCampaignPrices } =
      await import("./episode-campaign-price");
    const result = await listEpisodeCampaignPrices({ episodeId: "EPISODE-ID" });

    expect(result.ok).toBe(false);
  });
});

describe("createEpisodeCampaignPrice", () => {
  it("sends the price, its currency, and the period with the operator's session", async () => {
    mockCreateEpisodeCampaignPrice.mockResolvedValue({
      campaignPrice: campaignPrice(
        "CAMPAIGN1",
        300,
        "2026-10-10T00:00:00Z",
        "2026-10-11T00:00:00Z"
      ),
    });

    const { createEpisodeCampaignPrice } =
      await import("./episode-campaign-price");
    const result = await createEpisodeCampaignPrice(createInput, "en");

    expect(mockCreateEpisodeCampaignPrice).toHaveBeenCalledWith(
      {
        currency: "JPY",
        endsAt: "2026-10-11T00:00:00Z",
        episodeId: "EPISODE-ID",
        price: 300,
        startsAt: "2026-10-10T00:00:00Z",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({
      campaignPrice: { id: "CAMPAIGN1", price: 300 },
      ok: true,
    });
  });

  it.each([
    [
      "an overlap as one the editor can fix by choosing another period",
      new ConnectError("overlap", Code.FailedPrecondition),
      "The period overlaps a campaign price that is already scheduled. Choose another period or delete the existing one.",
    ],
    [
      "a refused price as one that has to undercut the episode's",
      invalidField("price"),
      "Campaign price must be lower than the episode's price.",
    ],
    [
      "a refused currency as the tenant's currency having changed",
      invalidField("currency"),
      "The tenant's currency changed after this form was opened. Reload the page and enter the price again.",
    ],
    [
      "a refused period as the period the form checks",
      invalidField("ends_at"),
      "Enter an end that is after the start and still in the future.",
    ],
  ])("words %s", async (_name, error, message) => {
    mockCreateEpisodeCampaignPrice.mockRejectedValue(error);

    const { createEpisodeCampaignPrice } =
      await import("./episode-campaign-price");
    const result = await createEpisodeCampaignPrice(createInput, "en");

    expect(result).toEqual({ message, ok: false });
  });
});

describe("createSeriesCampaignPrices", () => {
  const seriesInput = {
    currency: "JPY",
    endsAt: "2026-10-11T00:00:00Z",
    episodeIds: ["EP1", "EP2"],
    price: 300,
    seriesId: "SERIES-ID",
    startsAt: "2026-10-10T00:00:00Z",
    tenantId: "TENANT001",
  };

  it("names the chosen episodes and returns a campaign for each", async () => {
    mockCreateSeriesCampaignPrices.mockResolvedValue({
      campaignPrices: [
        campaignPrice(
          "CAMPAIGN1",
          300,
          "2026-10-10T00:00:00Z",
          "2026-10-11T00:00:00Z"
        ),
        campaignPrice(
          "CAMPAIGN2",
          300,
          "2026-10-10T00:00:00Z",
          "2026-10-11T00:00:00Z"
        ),
      ],
    });

    const { createSeriesCampaignPrices } =
      await import("./episode-campaign-price");
    const result = await createSeriesCampaignPrices(seriesInput, "en");

    expect(mockCreateSeriesCampaignPrices).toHaveBeenCalledWith(
      {
        currency: "JPY",
        endsAt: "2026-10-11T00:00:00Z",
        episodeIds: ["EP1", "EP2"],
        price: 300,
        seriesId: "SERIES-ID",
        startsAt: "2026-10-10T00:00:00Z",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.campaignPrices).toHaveLength(2);
  });

  it("words a refused price as one that has to undercut every chosen episode", async () => {
    mockCreateSeriesCampaignPrices.mockRejectedValue(invalidField("price"));

    const { createSeriesCampaignPrices } =
      await import("./episode-campaign-price");
    const result = await createSeriesCampaignPrices(seriesInput, "en");

    expect(result).toEqual({
      message:
        "Campaign price must be lower than the price of every selected episode. A free episode cannot have one.",
      ok: false,
    });
  });

  it("words an episode that left the series as a reason to reload", async () => {
    mockCreateSeriesCampaignPrices.mockRejectedValue(
      invalidField("episode_ids")
    );

    const { createSeriesCampaignPrices } =
      await import("./episode-campaign-price");
    const result = await createSeriesCampaignPrices(seriesInput, "en");

    expect(result).toEqual({
      message:
        "One of the chosen episodes is no longer in this series. Reload the page and try again.",
      ok: false,
    });
  });
});

describe("deleteEpisodeCampaignPrice", () => {
  it("reports a delete that removed the campaign", async () => {
    mockDeleteEpisodeCampaignPrice.mockResolvedValue({});

    const { deleteEpisodeCampaignPrice } =
      await import("./episode-campaign-price");
    const result = await deleteEpisodeCampaignPrice(
      { campaignPriceId: "CAMPAIGN1", tenantId: "TENANT001" },
      "en"
    );

    expect(mockDeleteEpisodeCampaignPrice).toHaveBeenCalledWith(
      { campaignPriceId: "CAMPAIGN1", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ alreadyDeleted: false, ok: true });
  });

  // Another operator deleted it first, or an earlier attempt committed and
  // lost its response: the campaign is gone either way, as the delete asked.
  it("treats a campaign that is already gone as deleted", async () => {
    mockDeleteEpisodeCampaignPrice.mockRejectedValue(
      new ConnectError("gone", Code.NotFound)
    );

    const { deleteEpisodeCampaignPrice } =
      await import("./episode-campaign-price");
    const result = await deleteEpisodeCampaignPrice(
      { campaignPriceId: "CAMPAIGN1", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({ alreadyDeleted: true, ok: true });
  });

  it("does not read a refused permission as a campaign that is gone", async () => {
    mockDeleteEpisodeCampaignPrice.mockRejectedValue(
      new ConnectError("denied", Code.PermissionDenied)
    );

    const { deleteEpisodeCampaignPrice } =
      await import("./episode-campaign-price");
    const result = await deleteEpisodeCampaignPrice(
      { campaignPriceId: "CAMPAIGN1", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toMatchObject({ ok: false });
  });
});
