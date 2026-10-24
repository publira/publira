import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockDeleteReaderIconPreset,
  mockGetAccessToken,
  mockUpdateTag,
  mockUpdateTenantReaderIconPolicy,
  mockUploadReaderIconPreset,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockDeleteReaderIconPreset: vi.fn(),
  mockGetAccessToken: vi.fn(() => Promise.resolve("session-token")),
  mockUpdateTag: vi.fn(),
  mockUpdateTenantReaderIconPolicy: vi.fn(),
  mockUploadReaderIconPreset: vi.fn(),
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

vi.mock("#lib/reader-icon-settings", () => ({
  deleteReaderIconPreset: mockDeleteReaderIconPreset,
  tenantReaderIconPolicyCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:reader-icon-policy`,
  tenantReaderIconPresetsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:reader-icon-presets`,
  updateTenantReaderIconPolicy: mockUpdateTenantReaderIconPolicy,
  uploadReaderIconPreset: mockUploadReaderIconPreset,
}));

const PRESET_ID = "0199e3a4-5b6c-7d8e-9f01-23456789abcd";

const formDataOf = (values: Record<string, File | string>): FormData => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }
  return formData;
};

const imageFile = (type = "image/png", size = 16) =>
  new File([new Uint8Array(size)], "icon.png", { type });

// Evaluating the Actions' module graph for the first time takes far longer than
// any test's own work, so it is paid here rather than inside one test's timeout.
beforeAll(async () => {
  await import("./actions");
});

describe("reader icon settings actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateReaderIconPolicyAction", () => {
    it("saves the picked policy and drops the tab's cached policy", async () => {
      mockUpdateTenantReaderIconPolicy.mockResolvedValueOnce({
        ok: true,
        policy: "preset",
      });
      const { updateReaderIconPolicyAction } = await import("./actions");

      const result = await updateReaderIconPolicyAction(
        null,
        formDataOf({ reader_icon_policy: "preset", tenant_id: "T1" })
      );

      expect(result).toEqual({
        message: "The reader icon policy was saved.",
        ok: true,
      });
      expect(mockAssertSameOrigin).toHaveBeenCalled();
      expect(mockUpdateTenantReaderIconPolicy).toHaveBeenCalledWith(
        { policy: "preset", tenantId: "T1" },
        "en"
      );
      expect(mockUpdateTag).toHaveBeenCalledWith(
        "tenant:T1:reader-icon-policy"
      );
    });

    it("refuses a value that names no policy", async () => {
      const { updateReaderIconPolicyAction } = await import("./actions");

      const result = await updateReaderIconPolicyAction(
        null,
        formDataOf({ reader_icon_policy: "everyone", tenant_id: "T1" })
      );

      expect(result).toEqual({
        message: "Select what readers can show.",
        ok: false,
      });
      expect(mockUpdateTenantReaderIconPolicy).not.toHaveBeenCalled();
      expect(mockUpdateTag).not.toHaveBeenCalled();
    });

    it("passes on what the API refused and keeps the cache", async () => {
      mockUpdateTenantReaderIconPolicy.mockResolvedValueOnce({
        message: "Could not save the reader icon policy.",
        ok: false,
      });
      const { updateReaderIconPolicyAction } = await import("./actions");

      const result = await updateReaderIconPolicyAction(
        null,
        formDataOf({ reader_icon_policy: "disabled", tenant_id: "T1" })
      );

      expect(result).toEqual({
        message: "Could not save the reader icon policy.",
        ok: false,
      });
      expect(mockUpdateTag).not.toHaveBeenCalled();
    });
  });

  describe("uploadReaderIconPresetAction", () => {
    it("sends the image's bytes and drops the gallery's cached list", async () => {
      mockUploadReaderIconPreset.mockResolvedValueOnce({ ok: true });
      const { uploadReaderIconPresetAction } = await import("./actions");

      const result = await uploadReaderIconPresetAction(
        null,
        formDataOf({ icon: imageFile("image/webp", 4), tenant_id: "T1" })
      );

      expect(result).toEqual({
        message: "The preset icon was added.",
        ok: true,
      });
      expect(mockUploadReaderIconPreset).toHaveBeenCalledWith(
        {
          iconContentType: "image/webp",
          iconData: new Uint8Array(4),
          tenantId: "T1",
        },
        "en"
      );
      expect(mockUpdateTag).toHaveBeenCalledWith(
        "tenant:T1:reader-icon-presets"
      );
    });

    it("asks for a file when none was chosen", async () => {
      const { uploadReaderIconPresetAction } = await import("./actions");

      const result = await uploadReaderIconPresetAction(
        null,
        formDataOf({ tenant_id: "T1" })
      );

      expect(result).toEqual({
        message: "Select an image file.",
        ok: false,
      });
      expect(mockUploadReaderIconPreset).not.toHaveBeenCalled();
    });

    it("refuses a type the API would not take", async () => {
      const { uploadReaderIconPresetAction } = await import("./actions");

      const result = await uploadReaderIconPresetAction(
        null,
        formDataOf({ icon: imageFile("image/gif"), tenant_id: "T1" })
      );

      expect(result).toEqual({
        message: "Select a JPEG, PNG, or WebP image.",
        ok: false,
      });
      expect(mockUploadReaderIconPreset).not.toHaveBeenCalled();
    });

    it("refuses an image over 10MB before sending it", async () => {
      const { uploadReaderIconPresetAction } = await import("./actions");

      const result = await uploadReaderIconPresetAction(
        null,
        formDataOf({
          icon: imageFile("image/png", 10 * 1024 * 1024 + 1),
          tenant_id: "T1",
        })
      );

      expect(result).toEqual({
        message: "The image must be 10MB or smaller.",
        ok: false,
      });
      expect(mockUploadReaderIconPreset).not.toHaveBeenCalled();
    });
  });

  describe("deleteReaderIconPresetAction", () => {
    it("deletes the preset and drops the gallery's cached list", async () => {
      mockDeleteReaderIconPreset.mockResolvedValueOnce({ ok: true });
      const { deleteReaderIconPresetAction } = await import("./actions");

      const result = await deleteReaderIconPresetAction(
        null,
        formDataOf({ preset_id: PRESET_ID, tenant_id: "T1" })
      );

      expect(result).toEqual({
        message: "The preset icon was deleted.",
        ok: true,
      });
      expect(mockDeleteReaderIconPreset).toHaveBeenCalledWith(
        { presetId: PRESET_ID, tenantId: "T1" },
        "en"
      );
      expect(mockUpdateTag).toHaveBeenCalledWith(
        "tenant:T1:reader-icon-presets"
      );
    });

    it("refuses a preset id that is not one", async () => {
      const { deleteReaderIconPresetAction } = await import("./actions");

      const result = await deleteReaderIconPresetAction(
        null,
        formDataOf({ preset_id: "not-an-id", tenant_id: "T1" })
      );

      expect(result).toEqual({
        message:
          "The preset icon could not be identified. Reload the page and try again.",
        ok: false,
      });
      expect(mockDeleteReaderIconPreset).not.toHaveBeenCalled();
    });
  });
});
