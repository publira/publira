import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreateCampaignBanner,
  mockDeleteCampaignBanner,
  mockGetAccessToken,
  mockRedirect,
  mockReorderCampaignBanners,
  mockUpdateCampaignBanner,
  mockUpdateTag,
  mockUploadCampaignBannerAspectImage,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreateCampaignBanner: vi.fn(),
  mockDeleteCampaignBanner: vi.fn(),
  mockGetAccessToken: vi.fn(),
  // `redirect()` ends the Action by throwing, which the tests stand in for.
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
  mockReorderCampaignBanners: vi.fn(),
  mockUpdateCampaignBanner: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUploadCampaignBannerAspectImage: vi.fn(),
}));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/tenant-timezone", () => ({
  getTenantDisplayTimeZone: () => Promise.resolve("Asia/Tokyo"),
}));

vi.mock("#lib/campaign-banner", () => ({
  campaignBannersCacheTag: (tenantId: string) => `campaign-banners-${tenantId}`,
  createCampaignBanner: mockCreateCampaignBanner,
  deleteCampaignBanner: mockDeleteCampaignBanner,
  reorderCampaignBanners: mockReorderCampaignBanners,
  updateCampaignBanner: mockUpdateCampaignBanner,
  uploadCampaignBannerAspectImage: mockUploadCampaignBannerAspectImage,
}));

const BANNER_ID = "018f0e6a-6000-7000-8000-000000000001";

const variant = {
  contentType: "image/webp",
  fileSizeBytes: 2048,
  height: 900,
  label: "landscape_1600w",
  url: "https://cdn.example.com/campaign-banners/BANNER001/landscape.webp",
  variantType: "landscape",
  width: 1600,
};

const savedBanner = (overrides: Record<string, unknown> = {}) => ({
  altText: "Summer sale, up to 50% off",
  endsAt: "2099-07-01T00:00:00Z",
  id: BANNER_ID,
  imageUpdatedAt: "2099-05-02T00:00:00Z",
  imageVariants: [variant],
  linkUrl: "/series/SERIES001",
  publicId: "BANNER001",
  published: true,
  startsAt: "2099-06-01T00:00:00Z",
  ...overrides,
});

const imageFile = () =>
  new File([new Uint8Array([1, 2, 3])], "banner.png", { type: "image/png" });

/** What the create form posts, with every field filled in. */
const createFormData = (fields: Record<string, string | File | null> = {}) => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("link_url", "/series/SERIES001");
  formData.set("alt_text", "  Summer sale, up to 50% off  ");
  formData.set("starts_at", "2099-06-01T00:00:00Z");
  formData.set("ends_at", "2099-07-01T00:00:00Z");
  formData.set("published", "on");
  formData.set("eye_catch_image", imageFile());

  for (const [name, value] of Object.entries(fields)) {
    if (value === null) {
      formData.delete(name);
    } else {
      formData.set(name, value);
    }
  }

  return formData;
};

/** What the edit screen's forms post: the create fields, the ID, no image. */
const updateFormData = (fields: Record<string, string | File | null> = {}) =>
  createFormData({
    campaign_banner_id: BANNER_ID,
    current_eye_catch_image_updated_at: "2099-05-01T00:00:00Z",
    eye_catch_image: null,
    ...fields,
  });

// Evaluating the Actions' module graph for the first time takes far longer than
// any test's own work, so it is paid here rather than inside one test's timeout.
beforeAll(async () => {
  await import("./actions");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  // `withAdminSessionReauth` resolves the session before the mutation runs;
  // without a token every Action under test would redirect to /login.
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("createCampaignBannerAction", () => {
  it("creates the banner and opens it", async () => {
    mockCreateCampaignBanner.mockResolvedValueOnce({
      banner: savedBanner(),
      ok: true,
    });

    const { createCampaignBannerAction } = await import("./actions");

    await expect(
      createCampaignBannerAction(null, createFormData())
    ).rejects.toThrow("redirect:/campaign-banners/BANNER001?created=1");
    expect(mockCreateCampaignBanner).toHaveBeenCalledWith(
      {
        // Trimmed, as the API stores it.
        altText: "Summer sale, up to 50% off",
        endsAt: "2099-07-01T00:00:00Z",
        imageContentType: "image/png",
        imageData: new Uint8Array([1, 2, 3]),
        linkUrl: "/series/SERIES001",
        published: true,
        startsAt: "2099-06-01T00:00:00Z",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("campaign-banners-TENANT001");
  });

  it("refuses a banner with no image before it reaches the API", async () => {
    const { createCampaignBannerAction } = await import("./actions");

    const result = await createCampaignBannerAction(
      null,
      createFormData({ eye_catch_image: null })
    );

    expect(result).toEqual({
      message: "Select the banner image.",
      ok: false,
    });
    expect(mockCreateCampaignBanner).not.toHaveBeenCalled();
  });

  it("refuses a banner with no link before it reaches the API", async () => {
    const { createCampaignBannerAction } = await import("./actions");

    const result = await createCampaignBannerAction(
      null,
      createFormData({ link_url: "  " })
    );

    expect(result).toEqual({
      message: "Enter where the banner links.",
      ok: false,
    });
    expect(mockCreateCampaignBanner).not.toHaveBeenCalled();
  });

  it("refuses an alternative text longer than the API stores", async () => {
    const { createCampaignBannerAction } = await import("./actions");

    const result = await createCampaignBannerAction(
      null,
      createFormData({ alt_text: "a".repeat(256) })
    );

    expect(result).toEqual({
      message: "Keep the alternative text to 255 characters or fewer.",
      ok: false,
    });
    expect(mockCreateCampaignBanner).not.toHaveBeenCalled();
  });

  it("refuses a link a browser would read as another site", async () => {
    const { createCampaignBannerAction } = await import("./actions");

    const result = await createCampaignBannerAction(
      null,
      createFormData({ link_url: "//example.com/campaign" })
    );

    expect(result).toMatchObject({ ok: false });
    expect(mockCreateCampaignBanner).not.toHaveBeenCalled();
  });

  it("refuses a window that is already over", async () => {
    const { createCampaignBannerAction } = await import("./actions");

    const result = await createCampaignBannerAction(
      null,
      createFormData({
        ends_at: "2000-01-02T00:00:00Z",
        starts_at: "2000-01-01T00:00:00Z",
      })
    );

    expect(result).toEqual({
      message: "The end has to come after the start and still be ahead.",
      ok: false,
    });
    expect(mockCreateCampaignBanner).not.toHaveBeenCalled();
  });

  it("opens the cover image tab when the stored image cannot be confirmed", async () => {
    mockCreateCampaignBanner.mockResolvedValueOnce({
      banner: savedBanner({ imageUpdatedAt: "", imageVariants: [] }),
      ok: true,
    });

    const { createCampaignBannerAction } = await import("./actions");

    await expect(
      createCampaignBannerAction(null, createFormData())
    ).rejects.toThrow("redirect:/campaign-banners/BANNER001?tab=eye-catch");
  });

  it("reports the API's refusal next to the form", async () => {
    mockCreateCampaignBanner.mockResolvedValueOnce({
      message: "Could not save the campaign banner.",
      ok: false,
    });

    const { createCampaignBannerAction } = await import("./actions");
    const result = await createCampaignBannerAction(null, createFormData());

    expect(result).toEqual({
      message: "Could not save the campaign banner.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("updateCampaignBannerAction", () => {
  it("replaces the link, the alternative text, the window, and the published flag, keeping the image", async () => {
    mockUpdateCampaignBanner.mockResolvedValueOnce({
      banner: savedBanner({ published: false }),
      ok: true,
    });

    const { updateCampaignBannerAction } = await import("./actions");

    const result = await updateCampaignBannerAction(
      null,
      updateFormData({
        alt_text: "Autumn sale",
        link_url: "https://example.com/sale",
        published: null,
      })
    );

    expect(result).toEqual({
      message: "Campaign banner updated.",
      ok: true,
    });
    expect(mockUpdateCampaignBanner).toHaveBeenCalledWith(
      {
        altText: "Autumn sale",
        endsAt: "2099-07-01T00:00:00Z",
        id: BANNER_ID,
        imageContentType: undefined,
        imageData: undefined,
        linkUrl: "https://example.com/sale",
        published: false,
        startsAt: "2099-06-01T00:00:00Z",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("campaign-banners-TENANT001");
  });

  it("leaves a window already over to the API, so an expired banner can be unpublished", async () => {
    mockUpdateCampaignBanner.mockResolvedValueOnce({
      banner: savedBanner(),
      ok: true,
    });

    const { updateCampaignBannerAction } = await import("./actions");

    const result = await updateCampaignBannerAction(
      null,
      updateFormData({
        ends_at: "2000-01-02T00:00:00Z",
        published: null,
        starts_at: "2000-01-01T00:00:00Z",
      })
    );

    expect(result).toMatchObject({ ok: true });
  });
});

describe("updateCampaignBannerImageAction", () => {
  it("replaces the whole image and confirms the new one was stored", async () => {
    mockUpdateCampaignBanner.mockResolvedValueOnce({
      banner: savedBanner(),
      ok: true,
    });

    const { updateCampaignBannerImageAction } = await import("./actions");

    const result = await updateCampaignBannerImageAction(
      null,
      updateFormData({ eye_catch_image: imageFile() })
    );

    expect(result).toEqual({ message: "Banner image updated.", ok: true });
    expect(mockUpdateCampaignBanner).toHaveBeenCalledWith(
      expect.objectContaining({
        imageContentType: "image/png",
        imageData: new Uint8Array([1, 2, 3]),
      }),
      "en"
    );
  });

  it("asks for an image rather than saving nothing", async () => {
    const { updateCampaignBannerImageAction } = await import("./actions");

    const result = await updateCampaignBannerImageAction(
      null,
      updateFormData()
    );

    expect(result).toEqual({
      message: "Select the banner image.",
      ok: false,
    });
    expect(mockUpdateCampaignBanner).not.toHaveBeenCalled();
  });

  it("does not report a save whose answer carries no generated images", async () => {
    mockUpdateCampaignBanner.mockResolvedValueOnce({
      banner: savedBanner({ imageVariants: [] }),
      ok: true,
    });

    const { updateCampaignBannerImageAction } = await import("./actions");

    const result = await updateCampaignBannerImageAction(
      null,
      updateFormData({ eye_catch_image: imageFile() })
    );

    expect(result).toEqual({
      message:
        "The upload was accepted, but generated images could not be confirmed. Please try again.",
      ok: false,
    });
  });

  it("does not report a save that kept the image the form was rendered with", async () => {
    mockUpdateCampaignBanner.mockResolvedValueOnce({
      banner: savedBanner({ imageUpdatedAt: "2099-05-01T00:00:00Z" }),
      ok: true,
    });

    const { updateCampaignBannerImageAction } = await import("./actions");

    const result = await updateCampaignBannerImageAction(
      null,
      updateFormData({ eye_catch_image: imageFile() })
    );

    expect(result).toEqual({
      message:
        "The upload has not been applied. Select the image again and try again.",
      ok: false,
    });
  });
});

describe("deleteCampaignBannerAction", () => {
  it("removes the banner and clears the list", async () => {
    mockDeleteCampaignBanner.mockResolvedValueOnce({ ok: true });

    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("campaign_banner_id", BANNER_ID);

    const { deleteCampaignBannerAction } = await import("./actions");
    const result = await deleteCampaignBannerAction(null, formData);

    expect(result).toEqual({ message: "Campaign banner deleted.", ok: true });
    expect(mockDeleteCampaignBanner).toHaveBeenCalledWith(
      { id: BANNER_ID, tenantId: "TENANT001" },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("campaign-banners-TENANT001");
  });
});

describe("reorderCampaignBannersAction", () => {
  const SECOND_ID = "018f0e6a-6000-7000-8000-000000000002";

  it("posts the new order beside the one the list was showing", async () => {
    mockReorderCampaignBanners.mockResolvedValueOnce({ ok: true });

    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("campaign_banner_ids", JSON.stringify([SECOND_ID, BANNER_ID]));
    formData.set(
      "expected_campaign_banner_ids",
      JSON.stringify([BANNER_ID, SECOND_ID])
    );

    const { reorderCampaignBannersAction } = await import("./actions");
    const result = await reorderCampaignBannersAction(formData);

    expect(result).toEqual({ ok: true });
    expect(mockReorderCampaignBanners).toHaveBeenCalledWith(
      {
        expectedIds: [BANNER_ID, SECOND_ID],
        ids: [SECOND_ID, BANNER_ID],
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("campaign-banners-TENANT001");
  });

  it("refuses an order that does not match the one it replaces", async () => {
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("campaign_banner_ids", JSON.stringify([BANNER_ID]));
    formData.set(
      "expected_campaign_banner_ids",
      JSON.stringify([BANNER_ID, SECOND_ID])
    );

    const { reorderCampaignBannersAction } = await import("./actions");
    const result = await reorderCampaignBannersAction(formData);

    expect(result).toEqual({
      message: "Could not change the banner order. Please try again later.",
      ok: false,
    });
    expect(mockReorderCampaignBanners).not.toHaveBeenCalled();
  });
});

describe("uploadCampaignBannerAspectImageAction", () => {
  it("names the ratio's minimum when the API refuses the image", async () => {
    mockUploadCampaignBannerAspectImage.mockResolvedValueOnce({
      imageRejected: true,
      ok: false,
    });

    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("campaign_banner_id", BANNER_ID);
    formData.set("variant_type", "landscape");
    formData.set("aspect_image", imageFile());

    const { uploadCampaignBannerAspectImageAction } = await import("./actions");
    const result = await uploadCampaignBannerAspectImageAction(null, formData);

    expect(result).toEqual({
      message:
        "Check the image. For this ratio, choose a JPEG, PNG, or WebP image no larger than 10MB and at least 1600x900px, then try again.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
