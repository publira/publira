import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockUpdateGenre,
  mockUpdateTag,
  mockUploadGenreEyeCatchAspectImage,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockUpdateGenre: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUploadGenreEyeCatchAspectImage: vi.fn(),
}));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/genre", () => ({
  createGenre: vi.fn(),
  deleteGenre: vi.fn(),
  genresCacheTag: (tenantId: string) => `genres-${tenantId}`,
  reorderGenres: vi.fn(),
  updateGenre: mockUpdateGenre,
  uploadGenreEyeCatchAspectImage: mockUploadGenreEyeCatchAspectImage,
}));

const variant = {
  contentType: "image/webp",
  fileSizeBytes: 1024,
  height: 1200,
  label: "square_1200w",
  url: "https://cdn.example.com/genres/GENRE001/square.webp",
  variantType: "square",
  width: 1200,
};

const savedGenre = (overrides: Record<string, unknown> = {}) => ({
  eyeCatchImageUpdatedAt: "2026-09-26T00:00:00Z",
  eyeCatchImageVariants: [variant],
  name: "Fantasy",
  publicId: "GENRE001",
  slug: "fantasy",
  ...overrides,
});

const eyeCatchFormData = (fields: Record<string, string | File> = {}) => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("public_id", "GENRE001");
  formData.set("name", "Fantasy");
  formData.set("clear_eye_catch_image", "0");
  formData.set("current_eye_catch_image_updated_at", "");
  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }
  return formData;
};

const aspectFormData = (fields: Record<string, string | File> = {}) => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("public_id", "GENRE001");
  formData.set("variant_type", "square");
  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }
  return formData;
};

const imageFile = () =>
  new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  // `withAdminSessionReauth` resolves the session before the mutation runs;
  // without a token every Action under test would redirect to /login.
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("updateGenreEyeCatchAction", () => {
  it("sends the picked image with the name the genre keeps", async () => {
    mockUpdateGenre.mockResolvedValueOnce({ genre: savedGenre(), ok: true });

    const { updateGenreEyeCatchAction } = await import("./actions");
    const result = await updateGenreEyeCatchAction(
      null,
      eyeCatchFormData({ eye_catch_image: imageFile() })
    );

    expect(mockUpdateGenre).toHaveBeenCalledWith(
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
    expect(result).toEqual({ message: "Cover image updated.", ok: true });
  });

  it("clears the genre list the storefront and the console read", async () => {
    mockUpdateGenre.mockResolvedValueOnce({ genre: savedGenre(), ok: true });

    const { updateGenreEyeCatchAction } = await import("./actions");
    await updateGenreEyeCatchAction(
      null,
      eyeCatchFormData({ eye_catch_image: imageFile() })
    );

    expect(mockUpdateTag).toHaveBeenCalledWith("genres-TENANT001");
  });

  it("asks for the removal without an image", async () => {
    mockUpdateGenre.mockResolvedValueOnce({
      genre: savedGenre({
        eyeCatchImageUpdatedAt: "",
        eyeCatchImageVariants: [],
      }),
      ok: true,
    });

    const { updateGenreEyeCatchAction } = await import("./actions");
    const result = await updateGenreEyeCatchAction(
      null,
      eyeCatchFormData({ clear_eye_catch_image: "1" })
    );

    expect(mockUpdateGenre.mock.calls[0]?.[0]).toMatchObject({
      clearEyeCatchImage: true,
      eyeCatchImageData: undefined,
    });
    expect(result?.ok).toBe(true);
    expect(mockUpdateTag).toHaveBeenCalledWith("genres-TENANT001");
  });

  it("reports an upload that came back without generated images", async () => {
    mockUpdateGenre.mockResolvedValueOnce({
      genre: savedGenre({ eyeCatchImageVariants: [] }),
      ok: true,
    });

    const { updateGenreEyeCatchAction } = await import("./actions");
    const result = await updateGenreEyeCatchAction(
      null,
      eyeCatchFormData({ eye_catch_image: imageFile() })
    );

    expect(result).toEqual({
      message:
        "The upload was accepted, but generated images could not be confirmed. Please try again.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("reports an upload that left the saved timestamp where it was", async () => {
    mockUpdateGenre.mockResolvedValueOnce({ genre: savedGenre(), ok: true });

    const { updateGenreEyeCatchAction } = await import("./actions");
    const result = await updateGenreEyeCatchAction(
      null,
      eyeCatchFormData({
        current_eye_catch_image_updated_at: "2026-09-26T00:00:00Z",
        eye_catch_image: imageFile(),
      })
    );

    expect(result?.ok).toBe(false);
    expect(result?.message).toBe(
      "The upload has not been applied. Select the image again and try again."
    );
  });

  it("clears no cache when the API refuses the save", async () => {
    mockUpdateGenre.mockResolvedValueOnce({
      message: "Could not save the genre. Please try again later.",
      ok: false,
    });

    const { updateGenreEyeCatchAction } = await import("./actions");
    const result = await updateGenreEyeCatchAction(
      null,
      eyeCatchFormData({ eye_catch_image: imageFile() })
    );

    expect(result).toEqual({
      message: "Could not save the genre. Please try again later.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("uploadGenreEyeCatchAspectImageAction", () => {
  it("replaces one ratio and clears the genre list", async () => {
    mockUploadGenreEyeCatchAspectImage.mockResolvedValueOnce({
      genre: savedGenre(),
      ok: true,
    });

    const { uploadGenreEyeCatchAspectImageAction } = await import("./actions");
    const result = await uploadGenreEyeCatchAspectImageAction(
      null,
      aspectFormData({ aspect_image: imageFile(), crop: "0,0,1200,1200" })
    );

    expect(mockUploadGenreEyeCatchAspectImage).toHaveBeenCalledWith(
      {
        crop: { height: 1200, width: 1200, x: 0, y: 0 },
        imageContentType: "image/png",
        imageData: new Uint8Array([1, 2, 3]),
        publicId: "GENRE001",
        tenantId: "TENANT001",
        variantType: "square",
      },
      "en"
    );
    expect(result).toEqual({
      message: "The image for this ratio was replaced.",
      ok: true,
      variantType: "square",
    });
    expect(mockUpdateTag).toHaveBeenCalledWith("genres-TENANT001");
  });

  it("asks for an image before calling the API", async () => {
    const { uploadGenreEyeCatchAspectImageAction } = await import("./actions");
    const result = await uploadGenreEyeCatchAspectImageAction(
      null,
      aspectFormData()
    );

    expect(result).toEqual({
      message: "Select an image to upload.",
      ok: false,
      variantType: "square",
    });
    expect(mockUploadGenreEyeCatchAspectImage).not.toHaveBeenCalled();
  });

  it("leaves the wording of a refused image to the slot that sent it", async () => {
    mockUploadGenreEyeCatchAspectImage.mockResolvedValueOnce({
      imageRejected: true,
      ok: false,
    });

    const { uploadGenreEyeCatchAspectImageAction } = await import("./actions");
    const result = await uploadGenreEyeCatchAspectImageAction(
      null,
      aspectFormData({ aspect_image: imageFile() })
    );

    expect(result).toEqual({
      imageInvalid: true,
      ok: false,
      variantType: "square",
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
