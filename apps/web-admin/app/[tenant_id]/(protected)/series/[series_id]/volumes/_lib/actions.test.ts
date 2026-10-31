import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { VolumeItem } from "#lib/volume";

const {
  mockAssertSameOrigin,
  mockCreateVolume,
  mockDeleteVolumeCoverImage,
  mockGetAccessToken,
  mockGetTenantCurrency,
  mockPublishVolume,
  mockRedirect,
  mockReorderVolumes,
  mockSetVolumeEpisodes,
  mockUpdateTag,
  mockUpdateVolume,
  mockUploadVolumeCoverImage,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreateVolume: vi.fn(),
  mockDeleteVolumeCoverImage: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantCurrency: vi.fn(),
  mockPublishVolume: vi.fn(),
  // `redirect()` ends the Action by throwing, which the tests stand in for.
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
  mockReorderVolumes: vi.fn(),
  mockSetVolumeEpisodes: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateVolume: vi.fn(),
  mockUploadVolumeCoverImage: vi.fn(),
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

vi.mock("#lib/public-api", () => ({
  getTenantCurrency: mockGetTenantCurrency,
}));

vi.mock("#lib/volume", () => ({
  createVolume: mockCreateVolume,
  deleteVolumeCoverImage: mockDeleteVolumeCoverImage,
  publishVolume: mockPublishVolume,
  reorderVolumes: mockReorderVolumes,
  setVolumeEpisodes: mockSetVolumeEpisodes,
  updateVolume: mockUpdateVolume,
  uploadVolumeCoverImage: mockUploadVolumeCoverImage,
  volumesCacheTag: (tenantId: string, seriesId: string) =>
    `volumes-${tenantId}-${seriesId}`,
}));

const SERIES_ID = "018f0e6a-6000-7000-8000-0000000000a1";
const VOLUME_ID = "018f0e6a-6000-7000-8000-0000000000b1";
const OTHER_VOLUME_ID = "018f0e6a-6000-7000-8000-0000000000b2";
const EPISODE_ONE = "018f0e6a-6000-7000-8000-0000000000c1";
const EPISODE_TWO = "018f0e6a-6000-7000-8000-0000000000c2";

const savedVolume = (overrides: Partial<VolumeItem> = {}) => ({
  coverImageUpdatedAt: "",
  coverImageVariants: [],
  episodeIds: [],
  id: VOLUME_ID,
  price: 1200,
  publicId: "VOLUME001",
  published: false,
  publishedAt: "",
  title: "Volume 1",
  ...overrides,
});

const portraitVariant = {
  contentType: "image/webp",
  fileSizeBytes: 2048,
  height: 1600,
  label: "portrait_1200w",
  url: "https://cdn.example.com/volume-covers/COVER001/portrait.webp",
  variantType: "portrait",
  width: 1200,
};

/** A form posting `fields` beside the tenant and the series every form names. */
const formData = (fields: Record<string, string | File>) => {
  const data = new FormData();
  data.set("tenant_id", "TENANT001");
  data.set("series_id", SERIES_ID);

  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }

  return data;
};

/** What the create form posts, with every field filled in. */
const createForm = (fields: Record<string, string> = {}) =>
  formData({
    price: "1200",
    price_currency: "JPY",
    series_public_id: "SERIES001",
    title: "Volume 1",
    ...fields,
  });

const coverFile = () =>
  new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" });

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
  mockGetTenantCurrency.mockResolvedValue("JPY");
});

describe("createVolumeAction", () => {
  it("creates the volume in the tenant's currency and opens it", async () => {
    mockCreateVolume.mockResolvedValueOnce({ ok: true, volume: savedVolume() });

    const { createVolumeAction } = await import("./actions");

    await expect(createVolumeAction(null, createForm())).rejects.toThrow(
      "redirect:/series/SERIES001/volumes/VOLUME001?created=1"
    );
    expect(mockCreateVolume).toHaveBeenCalledWith(
      {
        currency: "JPY",
        price: 1200,
        seriesId: SERIES_ID,
        tenantId: "TENANT001",
        title: "Volume 1",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `volumes-TENANT001-${SERIES_ID}`
    );
  });

  it("reads a price in the minor unit of a currency with decimals", async () => {
    mockGetTenantCurrency.mockResolvedValue("USD");
    mockCreateVolume.mockResolvedValueOnce({ ok: true, volume: savedVolume() });

    const { createVolumeAction } = await import("./actions");

    await expect(
      createVolumeAction(
        null,
        createForm({ price: "9.99", price_currency: "USD" })
      )
    ).rejects.toThrow("redirect:");
    expect(mockCreateVolume).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "USD", price: 999 }),
      "en"
    );
  });

  // A volume is never free, so the API would refuse it anyway.
  it("refuses a price of 0 before it reaches the API", async () => {
    const { createVolumeAction } = await import("./actions");

    await expect(
      createVolumeAction(null, createForm({ price: "0" }))
    ).resolves.toEqual({
      message:
        "Enter a price above 0, with no more decimal places than the tenant's currency has.",
      ok: false,
    });
    expect(mockCreateVolume).not.toHaveBeenCalled();
  });

  it("refuses a form opened before the tenant's currency changed", async () => {
    mockGetTenantCurrency.mockResolvedValue("USD");

    const { createVolumeAction } = await import("./actions");

    const result = await createVolumeAction(null, createForm());

    expect(result).toMatchObject({ ok: false });
    expect(mockCreateVolume).not.toHaveBeenCalled();
  });

  it("refuses a blank title", async () => {
    const { createVolumeAction } = await import("./actions");

    await expect(
      createVolumeAction(null, createForm({ title: "   " }))
    ).resolves.toMatchObject({
      message: "Enter the volume's title.",
      ok: false,
    });
    expect(mockCreateVolume).not.toHaveBeenCalled();
  });

  it("reports the API's refusal and stays on the form", async () => {
    mockCreateVolume.mockResolvedValueOnce({
      message: "This series already holds as many volumes as it may.",
      ok: false,
    });

    const { createVolumeAction } = await import("./actions");

    await expect(createVolumeAction(null, createForm())).resolves.toEqual({
      message: "This series already holds as many volumes as it may.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("updateVolumeAction", () => {
  it("replaces the title and the price together", async () => {
    mockUpdateVolume.mockResolvedValueOnce({
      ok: true,
      volume: savedVolume({ price: 1500, title: "Volume one" }),
    });

    const { updateVolumeAction } = await import("./actions");

    await expect(
      updateVolumeAction(
        null,
        formData({
          price: "1500",
          price_currency: "JPY",
          title: "Volume one",
          volume_id: VOLUME_ID,
        })
      )
    ).resolves.toEqual({ message: "Volume updated.", ok: true });
    expect(mockUpdateVolume).toHaveBeenCalledWith(
      {
        currency: "JPY",
        id: VOLUME_ID,
        price: 1500,
        tenantId: "TENANT001",
        title: "Volume one",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `volumes-TENANT001-${SERIES_ID}`
    );
  });
});

describe("publishVolumeAction", () => {
  it("puts the volume on sale", async () => {
    mockPublishVolume.mockResolvedValueOnce({
      ok: true,
      volume: savedVolume({ published: true }),
    });

    const { publishVolumeAction } = await import("./actions");

    await expect(
      publishVolumeAction(
        null,
        formData({ published: "1", volume_id: VOLUME_ID })
      )
    ).resolves.toEqual({ message: "The volume is on sale.", ok: true });
    expect(mockPublishVolume).toHaveBeenCalledWith(
      { id: VOLUME_ID, published: true, tenantId: "TENANT001" },
      "en"
    );
  });

  it("takes the volume off sale", async () => {
    mockPublishVolume.mockResolvedValueOnce({
      ok: true,
      volume: savedVolume({ published: false }),
    });

    const { publishVolumeAction } = await import("./actions");

    await expect(
      publishVolumeAction(
        null,
        formData({ published: "0", volume_id: VOLUME_ID })
      )
    ).resolves.toEqual({ message: "The volume was taken off sale.", ok: true });
    expect(mockPublishVolume).toHaveBeenCalledWith(
      { id: VOLUME_ID, published: false, tenantId: "TENANT001" },
      "en"
    );
  });
});

describe("setVolumeEpisodesAction", () => {
  it("replaces the episodes with the list in the order posted", async () => {
    mockSetVolumeEpisodes.mockResolvedValueOnce({
      ok: true,
      volume: savedVolume({ episodeIds: [EPISODE_TWO, EPISODE_ONE] }),
    });

    const { setVolumeEpisodesAction } = await import("./actions");

    await expect(
      setVolumeEpisodesAction(
        null,
        formData({
          episode_ids: JSON.stringify([EPISODE_TWO, EPISODE_ONE]),
          volume_id: VOLUME_ID,
        })
      )
    ).resolves.toEqual({ message: "Episodes saved.", ok: true });
    expect(mockSetVolumeEpisodes).toHaveBeenCalledWith(
      {
        episodeIds: [EPISODE_TWO, EPISODE_ONE],
        id: VOLUME_ID,
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `volumes-TENANT001-${SERIES_ID}`
    );
  });

  it("refuses an episode named twice", async () => {
    const { setVolumeEpisodesAction } = await import("./actions");

    const result = await setVolumeEpisodesAction(
      null,
      formData({
        episode_ids: JSON.stringify([EPISODE_ONE, EPISODE_ONE]),
        volume_id: VOLUME_ID,
      })
    );

    expect(result).toMatchObject({ ok: false });
    expect(mockSetVolumeEpisodes).not.toHaveBeenCalled();
  });

  it("refuses an entry that is not an episode id", async () => {
    const { setVolumeEpisodesAction } = await import("./actions");

    const result = await setVolumeEpisodesAction(
      null,
      formData({
        episode_ids: JSON.stringify(["not-an-id"]),
        volume_id: VOLUME_ID,
      })
    );

    expect(result).toMatchObject({ ok: false });
    expect(mockSetVolumeEpisodes).not.toHaveBeenCalled();
  });
});

describe("reorderVolumesAction", () => {
  it("posts the new order beside the order the screen was showing", async () => {
    mockReorderVolumes.mockResolvedValueOnce({ ok: true });

    const { reorderVolumesAction } = await import("./actions");

    await expect(
      reorderVolumesAction(
        formData({
          expected_volume_ids: JSON.stringify([VOLUME_ID, OTHER_VOLUME_ID]),
          volume_ids: JSON.stringify([OTHER_VOLUME_ID, VOLUME_ID]),
        })
      )
    ).resolves.toEqual({ ok: true });
    expect(mockReorderVolumes).toHaveBeenCalledWith(
      {
        expectedIds: [VOLUME_ID, OTHER_VOLUME_ID],
        ids: [OTHER_VOLUME_ID, VOLUME_ID],
        seriesId: SERIES_ID,
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `volumes-TENANT001-${SERIES_ID}`
    );
  });

  it("refuses an order that is not as long as the one it replaces", async () => {
    const { reorderVolumesAction } = await import("./actions");

    await expect(
      reorderVolumesAction(
        formData({
          expected_volume_ids: JSON.stringify([VOLUME_ID, OTHER_VOLUME_ID]),
          volume_ids: JSON.stringify([VOLUME_ID]),
        })
      )
    ).resolves.toEqual({
      message: "Could not change the volume order. Please try again later.",
      ok: false,
    });
    expect(mockReorderVolumes).not.toHaveBeenCalled();
  });
});

describe("updateVolumeCoverAction", () => {
  it("uploads the picked image as the volume's cover", async () => {
    mockUploadVolumeCoverImage.mockResolvedValueOnce({
      ok: true,
      volume: savedVolume({
        coverImageUpdatedAt: "2099-05-02T00:00:00Z",
        coverImageVariants: [portraitVariant],
      }),
    });

    const { updateVolumeCoverAction } = await import("./actions");

    await expect(
      updateVolumeCoverAction(
        null,
        formData({
          clear_eye_catch_image: "0",
          current_eye_catch_image_updated_at: "2099-05-01T00:00:00Z",
          eye_catch_image: coverFile(),
          volume_id: VOLUME_ID,
        })
      )
    ).resolves.toEqual({ message: "Cover image updated.", ok: true });
    expect(mockUploadVolumeCoverImage).toHaveBeenCalledWith(
      {
        id: VOLUME_ID,
        imageContentType: "image/png",
        imageData: new Uint8Array([1, 2, 3]),
        tenantId: "TENANT001",
      },
      "en"
    );
  });

  it("reports an upload the API answered with the cover it already had", async () => {
    mockUploadVolumeCoverImage.mockResolvedValueOnce({
      ok: true,
      volume: savedVolume({
        coverImageUpdatedAt: "2099-05-01T00:00:00Z",
        coverImageVariants: [portraitVariant],
      }),
    });

    const { updateVolumeCoverAction } = await import("./actions");

    await expect(
      updateVolumeCoverAction(
        null,
        formData({
          clear_eye_catch_image: "0",
          current_eye_catch_image_updated_at: "2099-05-01T00:00:00Z",
          eye_catch_image: coverFile(),
          volume_id: VOLUME_ID,
        })
      )
    ).resolves.toEqual({
      message:
        "The upload has not been applied. Select the image again and try again.",
      ok: false,
    });
  });

  it("removes the cover when the delete toggle is set", async () => {
    mockDeleteVolumeCoverImage.mockResolvedValueOnce({
      ok: true,
      volume: savedVolume(),
    });

    const { updateVolumeCoverAction } = await import("./actions");

    await expect(
      updateVolumeCoverAction(
        null,
        formData({ clear_eye_catch_image: "1", volume_id: VOLUME_ID })
      )
    ).resolves.toEqual({ message: "Cover image deleted.", ok: true });
    expect(mockDeleteVolumeCoverImage).toHaveBeenCalledWith(
      { id: VOLUME_ID, tenantId: "TENANT001" },
      "en"
    );
    expect(mockUploadVolumeCoverImage).not.toHaveBeenCalled();
  });

  it("asks for a choice when nothing was picked", async () => {
    const { updateVolumeCoverAction } = await import("./actions");

    await expect(
      updateVolumeCoverAction(
        null,
        formData({ clear_eye_catch_image: "0", volume_id: VOLUME_ID })
      )
    ).resolves.toEqual({
      message: "Select an image, or choose to delete the current one.",
      ok: false,
    });
  });
});
