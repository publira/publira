import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockCreateVolume,
  mockDeleteVolumeCoverImage,
  mockGetAccessToken,
  mockListVolumes,
  mockPublishVolume,
  mockReorderVolumes,
  mockSetVolumeEpisodes,
  mockUpdateVolume,
  mockUploadVolumeCoverImage,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockCreateVolume: vi.fn(),
  mockDeleteVolumeCoverImage: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockListVolumes: vi.fn(),
  mockPublishVolume: vi.fn(),
  mockReorderVolumes: vi.fn(),
  mockSetVolumeEpisodes: vi.fn(),
  mockUpdateVolume: vi.fn(),
  mockUploadVolumeCoverImage: vi.fn(),
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
      createVolume: mockCreateVolume,
      deleteVolumeCoverImage: mockDeleteVolumeCoverImage,
      listVolumes: mockListVolumes,
      publishVolume: mockPublishVolume,
      reorderVolumes: mockReorderVolumes,
      setVolumeEpisodes: mockSetVolumeEpisodes,
      updateVolume: mockUpdateVolume,
      uploadVolumeCoverImage: mockUploadVolumeCoverImage,
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

const SERIES_ID = "018f0e6a-6000-7000-8000-0000000000a1";

const portraitVariant = {
  contentType: "image/webp",
  fileSizeBytes: 2048,
  height: 1600,
  label: "portrait_1200w",
  url: "https://cdn.example.com/volume-covers/COVER001/portrait.webp",
  variantType: "portrait",
  width: 1200,
};

const rawVolume = {
  coverImageUpdatedAt: "2099-05-01T00:00:00Z",
  coverImageVariants: [{ ...portraitVariant, fileSizeBytes: 2048n }],
  episodeIds: ["EPISODE001", "EPISODE002"],
  id: "018f0e6a-6000-7000-8000-0000000000b1",
  price: 1200,
  publicId: "VOLUME001",
  published: true,
  publishedAt: "2099-05-01T00:00:00Z",
  title: "Volume 1",
};

const mappedVolume = {
  ...rawVolume,
  coverImageVariants: [portraitVariant],
};

const series = { seriesId: SERIES_ID, tenantId: "TENANT001" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("listVolumes", () => {
  // The API admits no service credential on this RPC, so the read is the
  // operator's own.
  it("reads the series' volumes with the operator's session, under the series' volume tag", async () => {
    mockListVolumes.mockResolvedValueOnce({ volumes: [rawVolume] });

    const { listVolumes } = await import("./volume");
    const result = await listVolumes(series, "en");

    expect(result).toEqual({ ok: true, volumes: [mappedVolume] });
    expect(mockListVolumes).toHaveBeenCalledWith(
      { seriesId: SERIES_ID, tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(`volumes-TENANT001-${SERIES_ID}`);
  });

  it("drops a cover variant the API sent without a URL", async () => {
    mockListVolumes.mockResolvedValueOnce({
      volumes: [
        {
          ...rawVolume,
          coverImageVariants: [
            ...rawVolume.coverImageVariants,
            { ...portraitVariant, label: "portrait_600w", url: "" },
          ],
        },
      ],
    });

    const { listVolumes } = await import("./volume");

    await expect(listVolumes(series, "en")).resolves.toEqual({
      ok: true,
      volumes: [mappedVolume],
    });
  });

  it("asks the page to sign the operator in again when the API rejects the session", async () => {
    mockListVolumes.mockRejectedValue(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    const { listVolumes } = await import("./volume");

    await expect(listVolumes(series, "en")).resolves.toMatchObject({
      ok: false,
      requiresSignIn: true,
      volumes: [],
    });
  });

  it("reports a failed read as a message and drops the cache entry", async () => {
    mockListVolumes.mockRejectedValue(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    const { listVolumes } = await import("./volume");

    await expect(listVolumes(series, "en")).resolves.toMatchObject({
      ok: false,
      volumes: [],
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("getVolume", () => {
  it("picks the volume out of the list by its public id, beside the rest", async () => {
    mockListVolumes.mockResolvedValueOnce({ volumes: [rawVolume] });

    const { getVolume } = await import("./volume");

    await expect(
      getVolume({ ...series, publicId: "VOLUME001" }, "en")
    ).resolves.toEqual({
      ok: true,
      volume: mappedVolume,
      volumes: [mappedVolume],
    });
  });

  it("reports a volume the series does not hold as not found", async () => {
    mockListVolumes.mockResolvedValueOnce({ volumes: [rawVolume] });

    const { getVolume } = await import("./volume");

    await expect(
      getVolume({ ...series, publicId: "VOLUME999" }, "en")
    ).resolves.toEqual({ notFound: true, ok: false });
  });
});

describe("createVolume", () => {
  const input = {
    currency: "JPY",
    price: 1200,
    seriesId: SERIES_ID,
    tenantId: "TENANT001",
    title: "Volume 1",
  };

  it("sends the title, the price, and its currency with the operator's session", async () => {
    mockCreateVolume.mockResolvedValueOnce({ volume: rawVolume });

    const { createVolume } = await import("./volume");

    await expect(createVolume(input, "en")).resolves.toEqual({
      ok: true,
      volume: mappedVolume,
    });
    expect(mockCreateVolume).toHaveBeenCalledWith(
      {
        currency: "JPY",
        price: 1200,
        seriesId: SERIES_ID,
        tenant: { tenantId: "TENANT001" },
        title: "Volume 1",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("words the series' volume limit", async () => {
    mockCreateVolume.mockRejectedValue(
      new ConnectError("too many", Code.FailedPrecondition)
    );

    const { createVolume } = await import("./volume");

    await expect(createVolume(input, "en")).resolves.toEqual({
      message: "This series already holds as many volumes as it may.",
      ok: false,
    });
  });

  it("words a currency the tenant no longer sells in", async () => {
    mockCreateVolume.mockRejectedValue(invalidField("currency"));

    const { createVolume } = await import("./volume");

    await expect(createVolume(input, "en")).resolves.toEqual({
      message:
        "The tenant's currency changed after this form was opened. Reload the page and enter the price again.",
      ok: false,
    });
  });

  it("words a refused price", async () => {
    mockCreateVolume.mockRejectedValue(invalidField("price"));

    const { createVolume } = await import("./volume");

    await expect(createVolume(input, "en")).resolves.toEqual({
      message:
        "Enter a price above 0, with no more decimal places than the tenant's currency has.",
      ok: false,
    });
  });
});

describe("publishVolume", () => {
  it("words the refusal of a volume holding no episodes", async () => {
    mockPublishVolume.mockRejectedValue(
      new ConnectError("empty", Code.FailedPrecondition)
    );

    const { publishVolume } = await import("./volume");

    await expect(
      publishVolume(
        { id: rawVolume.id, published: true, tenantId: "TENANT001" },
        "en"
      )
    ).resolves.toEqual({
      message: "Add an episode to the volume before putting it on sale.",
      ok: false,
    });
  });
});

describe("setVolumeEpisodes", () => {
  it("sends the whole list in its order", async () => {
    mockSetVolumeEpisodes.mockResolvedValueOnce({ volume: rawVolume });

    const { setVolumeEpisodes } = await import("./volume");

    await setVolumeEpisodes(
      {
        episodeIds: ["EPISODE002", "EPISODE001"],
        id: rawVolume.id,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockSetVolumeEpisodes).toHaveBeenCalledWith(
      {
        episodeIds: ["EPISODE002", "EPISODE001"],
        tenant: { tenantId: "TENANT001" },
        volumeId: rawVolume.id,
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("words a list composed from a screen that no longer matches", async () => {
    mockSetVolumeEpisodes.mockRejectedValue(
      new ConnectError("taken", Code.FailedPrecondition)
    );

    const { setVolumeEpisodes } = await import("./volume");

    await expect(
      setVolumeEpisodes(
        { episodeIds: ["EPISODE001"], id: rawVolume.id, tenantId: "TENANT001" },
        "en"
      )
    ).resolves.toEqual({
      message:
        "Another volume now holds one of these episodes, or an episode was taken out of a volume that has been on sale. Reload the page and try again.",
      ok: false,
    });
  });
});

describe("reorderVolumes", () => {
  it("sends the new order beside the one it was composed from", async () => {
    mockReorderVolumes.mockResolvedValueOnce({ volumes: [] });

    const { reorderVolumes } = await import("./volume");

    await expect(
      reorderVolumes(
        { ...series, expectedIds: ["A", "B"], ids: ["B", "A"] },
        "en"
      )
    ).resolves.toEqual({ ok: true });
    expect(mockReorderVolumes).toHaveBeenCalledWith(
      {
        expectedVolumeIds: ["A", "B"],
        seriesId: SERIES_ID,
        tenant: { tenantId: "TENANT001" },
        volumeIds: ["B", "A"],
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("words an order someone else changed meanwhile", async () => {
    mockReorderVolumes.mockRejectedValue(
      new ConnectError("changed", Code.FailedPrecondition)
    );

    const { reorderVolumes } = await import("./volume");

    await expect(
      reorderVolumes(
        { ...series, expectedIds: ["A", "B"], ids: ["B", "A"] },
        "en"
      )
    ).resolves.toEqual({
      message:
        "The volume order changed somewhere else. Reload the page and try again.",
      ok: false,
    });
  });
});

describe("uploadVolumeCoverImage", () => {
  it("words an image the API refused", async () => {
    mockUploadVolumeCoverImage.mockRejectedValue(invalidField("image_data"));

    const { uploadVolumeCoverImage } = await import("./volume");

    await expect(
      uploadVolumeCoverImage(
        {
          id: rawVolume.id,
          imageData: new Uint8Array([1]),
          tenantId: "TENANT001",
        },
        "en"
      )
    ).resolves.toEqual({
      message:
        "Check the image. Choose a JPEG, PNG, or WebP image no larger than 10MB and at least 2400x3200px, then try again.",
      ok: false,
    });
  });
});

describe("deleteVolumeCoverImage", () => {
  it("removes the cover with the operator's session", async () => {
    mockDeleteVolumeCoverImage.mockResolvedValueOnce({
      volume: { ...rawVolume, coverImageUpdatedAt: "", coverImageVariants: [] },
    });

    const { deleteVolumeCoverImage } = await import("./volume");

    await expect(
      deleteVolumeCoverImage({ id: rawVolume.id, tenantId: "TENANT001" }, "en")
    ).resolves.toEqual({
      ok: true,
      volume: {
        ...mappedVolume,
        coverImageUpdatedAt: "",
        coverImageVariants: [],
      },
    });
    expect(mockDeleteVolumeCoverImage).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" }, volumeId: rawVolume.id },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });
});
