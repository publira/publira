import {
  BadRequestSchema,
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockCreateCampaignBanner,
  mockDeleteCampaignBanner,
  mockGetAccessToken,
  mockListCampaignBanners,
  mockReorderCampaignBanners,
  mockUpdateCampaignBanner,
  mockUploadCampaignBannerAspectImage,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockCreateCampaignBanner: vi.fn(),
  mockDeleteCampaignBanner: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockListCampaignBanners: vi.fn(),
  mockReorderCampaignBanners: vi.fn(),
  mockUpdateCampaignBanner: vi.fn(),
  mockUploadCampaignBannerAspectImage: vi.fn(),
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
    campaignBanners: {
      createCampaignBanner: mockCreateCampaignBanner,
      deleteCampaignBanner: mockDeleteCampaignBanner,
      listCampaignBanners: mockListCampaignBanners,
      reorderCampaignBanners: mockReorderCampaignBanners,
      updateCampaignBanner: mockUpdateCampaignBanner,
      uploadCampaignBannerAspectImage: mockUploadCampaignBannerAspectImage,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

/** The same failure, with the field the API names as the one it refused. */
const invalidField = (field: string) =>
  new ConnectError("invalid", Code.InvalidArgument, undefined, [
    { desc: BadRequestSchema, value: { fieldViolations: [{ field }] } },
  ]);

const reasonError = (code: Code, reason: string) =>
  new ConnectError("refused", code, undefined, [
    { desc: ErrorInfoSchema, value: { domain: "publira", reason } },
  ]);

const landscapeVariant = {
  contentType: "image/webp",
  fileSizeBytes: 2048,
  height: 900,
  label: "landscape_1600w",
  url: "https://cdn.example.com/campaign-banners/BANNER001/landscape.webp",
  variantType: "landscape",
  width: 1600,
};

const rawBanner = {
  endsAt: "2099-07-01T00:00:00Z",
  id: "018f0e6a-6000-7000-8000-000000000001",
  imageUpdatedAt: "2099-05-01T00:00:00Z",
  imageVariants: [{ ...landscapeVariant, fileSizeBytes: 2048n }],
  linkUrl: "/series/SERIES001",
  publicId: "BANNER001",
  published: true,
  startsAt: "2099-06-01T00:00:00Z",
};

const mappedBanner = {
  ...rawBanner,
  imageVariants: [landscapeVariant],
};

const saveInput = {
  endsAt: "2099-07-01T00:00:00Z",
  linkUrl: "/series/SERIES001",
  published: true,
  startsAt: "2099-06-01T00:00:00Z",
  tenantId: "TENANT001",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("listCampaignBanners", () => {
  // The API admits no service credential on this RPC, so the read is the
  // operator's own.
  it("reads the tenant's banners with the operator's session, under the banner tag", async () => {
    mockListCampaignBanners.mockResolvedValueOnce({ banners: [rawBanner] });

    const { listCampaignBanners } = await import("./campaign-banner");
    const result = await listCampaignBanners("TENANT001", "en");

    expect(result).toEqual({ banners: [mappedBanner], ok: true });
    expect(mockListCampaignBanners).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("campaign-banners-TENANT001");
  });

  it("asks the page to sign the operator in again when the API rejects the session", async () => {
    mockListCampaignBanners.mockRejectedValue(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    const { listCampaignBanners } = await import("./campaign-banner");
    const result = await listCampaignBanners("TENANT001", "en");

    expect(result).toMatchObject({
      banners: [],
      ok: false,
      requiresSignIn: true,
    });
  });

  it("drops a variant the API sent without a URL", async () => {
    mockListCampaignBanners.mockResolvedValueOnce({
      banners: [
        {
          ...rawBanner,
          imageVariants: [
            ...rawBanner.imageVariants,
            { ...landscapeVariant, label: "landscape_800w", url: "" },
          ],
        },
      ],
    });

    const { listCampaignBanners } = await import("./campaign-banner");
    const result = await listCampaignBanners("TENANT001", "en");

    expect(result).toEqual({ banners: [mappedBanner], ok: true });
  });

  it("reports a failed read as a message and drops the cache entry", async () => {
    mockListCampaignBanners.mockRejectedValue(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    const { listCampaignBanners } = await import("./campaign-banner");
    const result = await listCampaignBanners("TENANT001", "en");

    expect(result).toMatchObject({ banners: [], ok: false });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("getCampaignBanner", () => {
  it("picks the banner out of the list by its public id", async () => {
    mockListCampaignBanners.mockResolvedValueOnce({ banners: [rawBanner] });

    const { getCampaignBanner } = await import("./campaign-banner");

    await expect(
      getCampaignBanner({ publicId: "BANNER001", tenantId: "TENANT001" }, "en")
    ).resolves.toEqual({ banner: mappedBanner, ok: true });
  });

  it("reports a banner the list does not hold as not found", async () => {
    mockListCampaignBanners.mockResolvedValueOnce({ banners: [rawBanner] });

    const { getCampaignBanner } = await import("./campaign-banner");

    await expect(
      getCampaignBanner({ publicId: "BANNER999", tenantId: "TENANT001" }, "en")
    ).resolves.toEqual({ notFound: true, ok: false });
  });
});

describe("createCampaignBanner", () => {
  it("sends the image, the link, and the window with the operator's session", async () => {
    mockCreateCampaignBanner.mockResolvedValueOnce({ banner: rawBanner });

    const { createCampaignBanner } = await import("./campaign-banner");
    const result = await createCampaignBanner(
      {
        ...saveInput,
        imageContentType: "image/png",
        imageData: new Uint8Array([1, 2, 3]),
      },
      "en"
    );

    expect(result).toEqual({ banner: mappedBanner, ok: true });
    expect(mockCreateCampaignBanner).toHaveBeenCalledWith(
      {
        endsAt: "2099-07-01T00:00:00Z",
        imageContentType: "image/png",
        imageData: new Uint8Array([1, 2, 3]),
        linkUrl: "/series/SERIES001",
        published: true,
        startsAt: "2099-06-01T00:00:00Z",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("tells the operator to delete an ended banner once the tenant holds the most it may", async () => {
    mockCreateCampaignBanner.mockRejectedValue(
      reasonError(Code.FailedPrecondition, "CAMPAIGN_BANNER_LIMIT")
    );

    const { createCampaignBanner } = await import("./campaign-banner");
    const result = await createCampaignBanner(
      { ...saveInput, imageData: new Uint8Array([1]) },
      "en"
    );

    expect(result).toEqual({
      message:
        "This site already holds as many campaign banners as it may. Delete one that has ended, then try again.",
      ok: false,
    });
  });

  it.each([
    [
      "image_data",
      "Check the image. Choose a JPEG, PNG, or WebP image no larger than 10MB and at least 2400x3200px, then try again.",
    ],
    [
      "link_url",
      "Enter a path on this site starting with / or a full http(s) URL, of at most 2048 characters.",
    ],
    ["ends_at", "The end has to come after the start and still be ahead."],
  ])(
    "words a refused %s by what the operator has to change",
    async (field, message) => {
      mockCreateCampaignBanner.mockRejectedValue(invalidField(field));

      const { createCampaignBanner } = await import("./campaign-banner");
      const result = await createCampaignBanner(
        { ...saveInput, imageData: new Uint8Array([1]) },
        "en"
      );

      expect(result).toEqual({ message, ok: false });
    }
  );
});

describe("updateCampaignBanner", () => {
  it("keeps the image the banner has when none is sent", async () => {
    mockUpdateCampaignBanner.mockResolvedValueOnce({ banner: rawBanner });

    const { updateCampaignBanner } = await import("./campaign-banner");
    await updateCampaignBanner({ ...saveInput, id: rawBanner.id }, "en");

    expect(mockUpdateCampaignBanner).toHaveBeenCalledWith(
      {
        campaignBannerId: rawBanner.id,
        endsAt: "2099-07-01T00:00:00Z",
        imageContentType: undefined,
        imageData: undefined,
        linkUrl: "/series/SERIES001",
        published: true,
        startsAt: "2099-06-01T00:00:00Z",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });
});

describe("reorderCampaignBanners", () => {
  it("posts the order it wants beside the order it was showing", async () => {
    mockReorderCampaignBanners.mockResolvedValueOnce({ banners: [] });

    const { reorderCampaignBanners } = await import("./campaign-banner");
    const result = await reorderCampaignBanners(
      { expectedIds: ["a", "b"], ids: ["b", "a"], tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({ ok: true });
    expect(mockReorderCampaignBanners).toHaveBeenCalledWith(
      {
        campaignBannerIds: ["b", "a"],
        expectedCampaignBannerIds: ["a", "b"],
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("reports an order someone else changed as a conflict", async () => {
    mockReorderCampaignBanners.mockRejectedValue(
      new ConnectError("order has changed", Code.FailedPrecondition)
    );

    const { reorderCampaignBanners } = await import("./campaign-banner");
    const result = await reorderCampaignBanners(
      { expectedIds: ["a", "b"], ids: ["b", "a"], tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      message:
        "The banner order changed somewhere else. Reload the page and try again.",
      ok: false,
    });
  });
});

describe("deleteCampaignBanner", () => {
  it("removes the banner with the operator's session", async () => {
    mockDeleteCampaignBanner.mockResolvedValueOnce({});

    const { deleteCampaignBanner } = await import("./campaign-banner");
    const result = await deleteCampaignBanner(
      { id: rawBanner.id, tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({ ok: true });
    expect(mockDeleteCampaignBanner).toHaveBeenCalledWith(
      { campaignBannerId: rawBanner.id, tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });
});

describe("uploadCampaignBannerAspectImage", () => {
  it("leaves the wording of a refused image to the slot that sent it", async () => {
    mockUploadCampaignBannerAspectImage.mockRejectedValue(
      invalidField("image_data")
    );

    const { uploadCampaignBannerAspectImage } =
      await import("./campaign-banner");
    const result = await uploadCampaignBannerAspectImage(
      {
        id: rawBanner.id,
        imageData: new Uint8Array([1]),
        tenantId: "TENANT001",
        variantType: "landscape",
      },
      "en"
    );

    expect(result).toEqual({ imageRejected: true, ok: false });
  });
});
