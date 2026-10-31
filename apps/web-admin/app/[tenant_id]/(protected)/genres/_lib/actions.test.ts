import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GenreItem } from "#lib/genre";

const {
  mockAssertSameOrigin,
  mockCreateGenre,
  mockGetAccessToken,
  mockSaveGenreNames,
  mockUpdateGenre,
  mockUpdateTag,
  mockUploadGenreEyeCatchAspectImage,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreateGenre: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockSaveGenreNames: vi.fn(),
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
  createGenre: mockCreateGenre,
  deleteGenre: vi.fn(),
  genresCacheTag: (tenantId: string) => `genres-${tenantId}`,
  reorderGenres: vi.fn(),
  saveGenreNames: mockSaveGenreNames,
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

const savedGenre = (overrides: Partial<GenreItem> = {}) => ({
  eyeCatchImageUpdatedAt: "2026-09-26T00:00:00Z",
  eyeCatchImageVariants: [variant],
  id: "018f0e6a-6000-7000-8000-000000000001",
  name: "Fantasy",
  slug: "fantasy",
  ...overrides,
});

const eyeCatchFormData = (fields: Record<string, string | File> = {}) => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("genre_id", "018f0e6a-6000-7000-8000-000000000001");
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
  formData.set("genre_id", "018f0e6a-6000-7000-8000-000000000001");
  formData.set("variant_type", "square");

  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }

  return formData;
};

const imageFile = () =>
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
});

/** A genre form with a field per language, the default one first. */
const namesFormData = (
  names: Record<string, string>,
  savedNames: Record<string, string> = {}
) => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("genre_id", "018f0e6a-6000-7000-8000-000000000001");
  formData.set("default_locale", "en");

  for (const [code, name] of Object.entries(names)) {
    formData.set(`name.${code}`, name);
  }

  for (const [code, name] of Object.entries(savedNames)) {
    formData.set(`saved_name.${code}`, name);
  }

  return formData;
};

describe("createGenreAction", () => {
  it("refuses a genre without a name in the default language", async () => {
    const { createGenreAction } = await import("./actions");

    const result = await createGenreAction(
      null,
      namesFormData({ en: "  ", ja: "Fantaji" })
    );

    expect(result).toEqual({ message: "Genre name is required.", ok: false });
    expect(mockCreateGenre).not.toHaveBeenCalled();
    expect(mockSaveGenreNames).not.toHaveBeenCalled();
  });

  it("creates the genre in the default language and adds the other names it was given", async () => {
    mockCreateGenre.mockResolvedValueOnce({ genre: savedGenre(), ok: true });
    mockSaveGenreNames.mockResolvedValueOnce({ ok: true });

    const { createGenreAction } = await import("./actions");

    const result = await createGenreAction(
      null,
      namesFormData({ en: " Fantasy ", ja: "Fantaji", ko: "" })
    );

    expect(mockCreateGenre).toHaveBeenCalledWith(
      { name: "Fantasy", tenantId: "TENANT001", translationLocale: "en" },
      "en"
    );
    expect(mockSaveGenreNames).toHaveBeenCalledWith(
      {
        id: "018f0e6a-6000-7000-8000-000000000001",
        names: [{ name: "Fantaji", translationLocale: "ja" }],
        removedLocales: [],
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(result).toEqual({ message: "Genre created.", ok: true });
    expect(mockUpdateTag).toHaveBeenCalledWith("genres-TENANT001");
  });

  it("says the genre exists when one of its other names was refused", async () => {
    mockCreateGenre.mockResolvedValueOnce({ genre: savedGenre(), ok: true });
    mockSaveGenreNames.mockResolvedValueOnce({
      message: "Could not save the genre. Please try again later.",
      ok: false,
    });

    const { createGenreAction } = await import("./actions");

    const result = await createGenreAction(
      null,
      namesFormData({ en: "Fantasy", ja: "Fantaji" })
    );

    expect(result).toEqual({
      message:
        "The genre was created, but not every name was saved. Could not save the genre. Please try again later. Open it with Edit to add the rest.",
      ok: false,
    });
    expect(mockUpdateTag).toHaveBeenCalledWith("genres-TENANT001");
  });
});

describe("renameGenreAction", () => {
  it("refuses to empty the default language's name", async () => {
    const { renameGenreAction } = await import("./actions");

    const result = await renameGenreAction(
      null,
      namesFormData({ en: "", ja: "Fantaji" }, { en: "Fantasy", ja: "Fantaji" })
    );

    expect(result).toEqual({ message: "Genre name is required.", ok: false });
    expect(mockSaveGenreNames).not.toHaveBeenCalled();
  });

  it("writes the names that changed and removes the ones emptied", async () => {
    mockSaveGenreNames.mockResolvedValueOnce({ ok: true });

    const { renameGenreAction } = await import("./actions");

    const result = await renameGenreAction(
      null,
      namesFormData(
        { en: "Fantasy", ja: "Fantaji", ko: "" },
        { en: "Fantasy", ko: "Fantasia" }
      )
    );

    expect(mockSaveGenreNames).toHaveBeenCalledWith(
      {
        id: "018f0e6a-6000-7000-8000-000000000001",
        names: [{ name: "Fantaji", translationLocale: "ja" }],
        removedLocales: ["ko"],
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(result).toEqual({ message: "Genre updated.", ok: true });
    expect(mockUpdateTag).toHaveBeenCalledWith("genres-TENANT001");
  });

  it("writes the one name a form without languages posts in the default language", async () => {
    mockSaveGenreNames.mockResolvedValueOnce({ ok: true });
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("genre_id", "018f0e6a-6000-7000-8000-000000000001");
    formData.set("name", "Mystery");
    formData.set("saved_name", "Fantasy");

    const { renameGenreAction } = await import("./actions");
    await renameGenreAction(null, formData);

    expect(mockSaveGenreNames).toHaveBeenCalledWith(
      {
        id: "018f0e6a-6000-7000-8000-000000000001",
        names: [{ name: "Mystery", translationLocale: undefined }],
        removedLocales: [],
        tenantId: "TENANT001",
      },
      "en"
    );
  });

  it("clears the list when a name was written before another was refused", async () => {
    mockSaveGenreNames.mockResolvedValueOnce({
      message: "A genre with this name already exists.",
      ok: false,
    });

    const { renameGenreAction } = await import("./actions");

    const result = await renameGenreAction(
      null,
      namesFormData({ en: "Mystery", ja: "Fantaji" })
    );

    expect(result).toEqual({
      message: "A genre with this name already exists.",
      ok: false,
    });
    expect(mockUpdateTag).toHaveBeenCalledWith("genres-TENANT001");
  });

  it("clears the list when a later write throws, and passes the error on", async () => {
    const error = new Error("unclassified");
    mockSaveGenreNames.mockRejectedValueOnce(error);

    const { renameGenreAction } = await import("./actions");
    await expect(
      renameGenreAction(null, namesFormData({ en: "Mystery", ja: "Fantaji" }))
    ).rejects.toBe(error);
    expect(mockUpdateTag).toHaveBeenCalledWith("genres-TENANT001");
  });
});

describe("updateGenreEyeCatchAction", () => {
  it("sends the picked image without a name, so every name stays as it is", async () => {
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
        id: "018f0e6a-6000-7000-8000-000000000001",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(result).toEqual({ message: "Cover image updated.", ok: true });
  });

  it("calls no API when neither an image nor the removal was sent", async () => {
    const { updateGenreEyeCatchAction } = await import("./actions");
    const result = await updateGenreEyeCatchAction(null, eyeCatchFormData());

    expect(mockUpdateGenre).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
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
        id: "018f0e6a-6000-7000-8000-000000000001",
        imageContentType: "image/png",
        imageData: new Uint8Array([1, 2, 3]),
        tenantId: "TENANT001",
        variantType: "square",
      },
      "en"
    );
    expect(result).toEqual({
      message: "The image for this ratio was replaced.",
      ok: true,
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
    });
    expect(mockUploadGenreEyeCatchAspectImage).not.toHaveBeenCalled();
  });

  it("names the minimum of the ratio a refused image was sent for", async () => {
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
      message:
        "Check the image. For this ratio, choose a JPEG, PNG, or WebP image no larger than 10MB and at least 1200x1200px, then try again.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
