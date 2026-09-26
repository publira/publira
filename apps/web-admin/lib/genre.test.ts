import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockCreateGenre,
  mockDeleteGenre,
  mockGetAccessToken,
  mockListGenres,
  mockReorderGenres,
  mockUpdateGenre,
  mockUploadGenreEyeCatchAspectImage,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockCreateGenre: vi.fn(),
  mockDeleteGenre: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockListGenres: vi.fn(),
  mockReorderGenres: vi.fn(),
  mockUpdateGenre: vi.fn(),
  mockUploadGenreEyeCatchAspectImage: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    genre: {
      createGenre: mockCreateGenre,
      deleteGenre: mockDeleteGenre,
      listGenres: mockListGenres,
      reorderGenres: mockReorderGenres,
      updateGenre: mockUpdateGenre,
      uploadGenreEyeCatchAspectImage: mockUploadGenreEyeCatchAspectImage,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

/** The same failure, with the field the API names as the one it refused. */
const invalidField = (message: string, field: string) =>
  new ConnectError(message, Code.InvalidArgument, undefined, [
    { desc: BadRequestSchema, value: { fieldViolations: [{ field }] } },
  ]);

/** A genre as the console maps it when the API sent no eye-catch. */
const withoutEyeCatch = (genre: {
  name: string;
  publicId: string;
  slug: string;
}) => ({ ...genre, eyeCatchImageUpdatedAt: "", eyeCatchImageVariants: [] });

const squareVariant = {
  contentType: "image/webp",
  fileSizeBytes: 1024,
  height: 1200,
  label: "square_1200w",
  url: "https://cdn.example.com/genres/GENRE001/square.webp",
  variantType: "square",
  width: 1200,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("listGenres", () => {
  it("walks every page and keeps the tenant's order", async () => {
    mockListGenres
      .mockResolvedValueOnce({
        genres: [
          { name: "Fantasy", publicId: "GENRE001", slug: "fantasy" },
          { name: "Mystery", publicId: "GENRE002", slug: "mystery" },
        ],
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        genres: [{ name: "Romance", publicId: "GENRE003", slug: "romance" }],
        nextToken: "",
      });

    const { listGenres } = await import("./genre");
    const result = await listGenres("TENANT001", "en");

    expect(result).toEqual({
      genres: [
        withoutEyeCatch({
          name: "Fantasy",
          publicId: "GENRE001",
          slug: "fantasy",
        }),
        withoutEyeCatch({
          name: "Mystery",
          publicId: "GENRE002",
          slug: "mystery",
        }),
        withoutEyeCatch({
          name: "Romance",
          publicId: "GENRE003",
          slug: "romance",
        }),
      ],
      ok: true,
    });
    expect(mockListGenres).toHaveBeenCalledTimes(2);
    expect(mockListGenres.mock.calls[1]?.[0]).toMatchObject({
      tenant: { tenantId: "TENANT001" },
      token: "page-2",
    });
  });

  it("reports a rejected session so the page can raise the login redirect", async () => {
    mockListGenres.mockRejectedValue(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    const { listGenres } = await import("./genre");
    const result = await listGenres("TENANT001", "en");

    expect(result).toMatchObject({
      genres: [],
      ok: false,
      requiresSignIn: true,
    });
  });

  it("keeps the eye-catch variants and drops one without a URL", async () => {
    mockListGenres.mockResolvedValueOnce({
      genres: [
        {
          eyeCatchImageUpdatedAt: "2026-09-26T00:00:00Z",
          eyeCatchImageVariants: [
            { ...squareVariant, fileSizeBytes: 1024n },
            {
              ...squareVariant,
              fileSizeBytes: 0n,
              label: "square_600w",
              url: "",
            },
          ],
          name: "Fantasy",
          publicId: "GENRE001",
          slug: "fantasy",
        },
      ],
      nextToken: "",
    });

    const { listGenres } = await import("./genre");
    const result = await listGenres("TENANT001", "en");

    expect(result).toEqual({
      genres: [
        {
          eyeCatchImageUpdatedAt: "2026-09-26T00:00:00Z",
          eyeCatchImageVariants: [squareVariant],
          name: "Fantasy",
          publicId: "GENRE001",
          slug: "fantasy",
        },
      ],
      ok: true,
    });
  });

  it("rethrows an unclassifiable failure instead of showing an empty list", async () => {
    mockListGenres.mockRejectedValue(new Error("boom"));

    const { listGenres } = await import("./genre");

    await expect(listGenres("TENANT001", "en")).rejects.toThrow("boom");
  });
});

describe("createGenre", () => {
  it("names the collision rather than the shared conflict wording", async () => {
    mockCreateGenre.mockRejectedValue(
      new ConnectError(
        "a genre with this name already exists",
        Code.AlreadyExists
      )
    );

    const { createGenre } = await import("./genre");
    const result = await createGenre(
      { name: "fantasy", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      message: "A genre with this name already exists.",
      ok: false,
    });
  });

  it("returns the created genre", async () => {
    mockCreateGenre.mockResolvedValue({
      genre: { name: "Fantasy", publicId: "GENRE001", slug: "fantasy" },
    });

    const { createGenre } = await import("./genre");
    const result = await createGenre(
      { name: "Fantasy", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      genre: withoutEyeCatch({
        name: "Fantasy",
        publicId: "GENRE001",
        slug: "fantasy",
      }),
      ok: true,
    });
    expect(mockCreateGenre).toHaveBeenCalledWith(
      { name: "Fantasy", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });
});

describe("updateGenre", () => {
  it("words a name the API cannot derive a slug from", async () => {
    mockUpdateGenre.mockRejectedValue(
      new ConnectError(
        "name must hold at least one letter",
        Code.InvalidArgument
      )
    );

    const { updateGenre } = await import("./genre");
    const result = await updateGenre(
      { name: "!!!", publicId: "GENRE001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      message:
        "Enter a genre name of at most 50 characters that holds at least one letter or number.",
      ok: false,
    });
  });
});

describe("getGenre", () => {
  it("picks the genre out of the tenant's list", async () => {
    mockListGenres.mockResolvedValueOnce({
      genres: [
        { name: "Fantasy", publicId: "GENRE001", slug: "fantasy" },
        { name: "Mystery", publicId: "GENRE002", slug: "mystery" },
      ],
      nextToken: "",
    });

    const { getGenre } = await import("./genre");
    const result = await getGenre(
      { publicId: "GENRE002", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      genre: withoutEyeCatch({
        name: "Mystery",
        publicId: "GENRE002",
        slug: "mystery",
      }),
      ok: true,
    });
  });

  it("answers not found for a genre the tenant does not have", async () => {
    mockListGenres.mockResolvedValueOnce({
      genres: [{ name: "Fantasy", publicId: "GENRE001", slug: "fantasy" }],
      nextToken: "",
    });

    const { getGenre } = await import("./genre");
    const result = await getGenre(
      { publicId: "GENRE404", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({ notFound: true, ok: false });
  });

  it("passes on a failed read with the login redirect it needs", async () => {
    mockListGenres.mockRejectedValue(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    const { getGenre } = await import("./genre");
    const result = await getGenre(
      { publicId: "GENRE001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
  });
});

describe("updateGenre with an eye-catch", () => {
  it("sends the image and the delete flag beside the name", async () => {
    mockUpdateGenre.mockResolvedValue({
      genre: { name: "Fantasy", publicId: "GENRE001", slug: "fantasy" },
    });

    const { updateGenre } = await import("./genre");
    await updateGenre(
      {
        clearEyeCatchImage: false,
        eyeCatchImageContentType: "image/png",
        eyeCatchImageData: new Uint8Array([1, 2, 3]),
        name: "Fantasy",
        publicId: "GENRE001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUpdateGenre).toHaveBeenCalledWith(
      {
        clearEyeCatchImage: false,
        eyeCatchImageContentType: "image/png",
        eyeCatchImageData: new Uint8Array([1, 2, 3]),
        name: "Fantasy",
        publicId: "GENRE001",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("words a refused image as the image rather than the name", async () => {
    mockUpdateGenre.mockRejectedValue(
      invalidField("image is too small", "eye_catch_image_data")
    );

    const { updateGenre } = await import("./genre");
    const result = await updateGenre(
      {
        eyeCatchImageData: new Uint8Array([1]),
        name: "Fantasy",
        publicId: "GENRE001",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "Check the image settings. Choose a JPEG, PNG, or WebP image no larger than 10MB and at least 2400x3200px, then try again.",
      ok: false,
    });
  });
});

describe("uploadGenreEyeCatchAspectImage", () => {
  it("returns the genre with the ratio it replaced", async () => {
    mockUploadGenreEyeCatchAspectImage.mockResolvedValue({
      genre: {
        eyeCatchImageUpdatedAt: "2026-09-26T00:00:00Z",
        eyeCatchImageVariants: [squareVariant],
        name: "Fantasy",
        publicId: "GENRE001",
        slug: "fantasy",
      },
    });

    const { uploadGenreEyeCatchAspectImage } = await import("./genre");
    const result = await uploadGenreEyeCatchAspectImage(
      {
        imageContentType: "image/png",
        imageData: new Uint8Array([1]),
        publicId: "GENRE001",
        tenantId: "TENANT001",
        variantType: "square",
      },
      "en"
    );

    expect(result).toMatchObject({
      genre: { eyeCatchImageVariants: [squareVariant] },
      ok: true,
    });
    expect(mockUploadGenreEyeCatchAspectImage).toHaveBeenCalledWith(
      {
        crop: undefined,
        imageContentType: "image/png",
        imageData: new Uint8Array([1]),
        publicId: "GENRE001",
        tenant: { tenantId: "TENANT001" },
        variantType: "square",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("leaves a refused image to the slot that sent it", async () => {
    mockUploadGenreEyeCatchAspectImage.mockRejectedValue(
      invalidField("image is too small", "image_data")
    );

    const { uploadGenreEyeCatchAspectImage } = await import("./genre");
    const result = await uploadGenreEyeCatchAspectImage(
      {
        imageData: new Uint8Array([1]),
        publicId: "GENRE001",
        tenantId: "TENANT001",
        variantType: "square",
      },
      "en"
    );

    expect(result).toEqual({ imageRejected: true, ok: false });
  });
});

describe("reorderGenres", () => {
  it("sends the order it wants beside the order it read", async () => {
    mockReorderGenres.mockResolvedValue({
      genres: [
        { name: "Mystery", publicId: "GENRE002", slug: "mystery" },
        { name: "Fantasy", publicId: "GENRE001", slug: "fantasy" },
      ],
    });

    const { reorderGenres } = await import("./genre");
    const result = await reorderGenres(
      {
        expectedPublicIds: ["GENRE001", "GENRE002"],
        publicIds: ["GENRE002", "GENRE001"],
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toMatchObject({ ok: true });
    expect(mockReorderGenres).toHaveBeenCalledWith(
      {
        expectedGenrePublicIds: ["GENRE001", "GENRE002"],
        genrePublicIds: ["GENRE002", "GENRE001"],
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("tells the operator to reload when the order moved underneath them", async () => {
    mockReorderGenres.mockRejectedValue(
      new ConnectError("genre order has changed", Code.FailedPrecondition)
    );

    const { reorderGenres } = await import("./genre");
    const result = await reorderGenres(
      {
        expectedPublicIds: ["GENRE001"],
        publicIds: ["GENRE001"],
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "The genre order changed somewhere else. Reload the page and try again.",
      ok: false,
    });
  });
});

describe("deleteGenre", () => {
  it("explains that a genre a series carries has to be unassigned first", async () => {
    mockDeleteGenre.mockRejectedValue(
      new ConnectError(
        "genre is assigned to 3 series and cannot be deleted",
        Code.FailedPrecondition
      )
    );

    const { deleteGenre } = await import("./genre");
    const result = await deleteGenre(
      { publicId: "GENRE001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      message:
        "This genre is assigned to one or more series. Remove it from every series before deleting it.",
      ok: false,
    });
  });

  it("resolves once the genre is gone", async () => {
    mockDeleteGenre.mockResolvedValue({});

    const { deleteGenre } = await import("./genre");
    const result = await deleteGenre(
      { publicId: "GENRE001", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({ ok: true });
  });
});
