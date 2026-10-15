import { ReaderIconPolicy } from "@publira/api-client/admin/types";
import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockDeleteReaderIconPresetApi,
  mockGetAccessToken,
  mockGetTenantReaderIconPolicyApi,
  mockListReaderIconPresetsApi,
  mockUpdateTenantReaderIconPolicyApi,
  mockUploadReaderIconPresetApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockDeleteReaderIconPresetApi: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantReaderIconPolicyApi: vi.fn(),
  mockListReaderIconPresetsApi: vi.fn(),
  mockUpdateTenantReaderIconPolicyApi: vi.fn(),
  mockUploadReaderIconPresetApi: vi.fn(),
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
    tenantSettings: {
      deleteReaderIconPreset: mockDeleteReaderIconPresetApi,
      getTenantReaderIconPolicy: mockGetTenantReaderIconPolicyApi,
      listReaderIconPresets: mockListReaderIconPresetsApi,
      updateTenantReaderIconPolicy: mockUpdateTenantReaderIconPolicyApi,
      uploadReaderIconPreset: mockUploadReaderIconPresetApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

/** A refusal carrying a `google.rpc.ErrorInfo` reason, as the API sends it. */
const reasonError = (code: Code, reason: string) =>
  new ConnectError("refused", code, undefined, [
    { desc: ErrorInfoSchema, value: { domain: "publira", reason } },
  ]);

const UNSTORABLE = { expire: 0, revalidate: 0, stale: 0 };

const STORAGE_NOT_CONFIGURED =
  "Images cannot be uploaded because image storage has not been set up on the platform yet. Ask a platform operator to set it up.";

describe("reader-icon-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  describe("getTenantReaderIconPolicy", () => {
    it("returns the saved policy under the tab's cache tag", async () => {
      mockGetTenantReaderIconPolicyApi.mockResolvedValueOnce({
        policy: ReaderIconPolicy.PRESET,
      });

      const { getTenantReaderIconPolicy } =
        await import("./reader-icon-settings");

      expect(await getTenantReaderIconPolicy("TENANT001", "en")).toEqual({
        ok: true,
        policy: "preset",
      });
      expect(mockGetTenantReaderIconPolicyApi).toHaveBeenCalledWith(
        { tenant: { tenantId: "TENANT001" } },
        { headers: { Authorization: "Bearer session-token" } }
      );
      expect(mockCacheTag).toHaveBeenCalledWith(
        "tenant:TENANT001:reader-icon-policy"
      );
      expect(mockCacheLife).not.toHaveBeenCalled();
    });

    it("treats an unspecified policy as a failed read", async () => {
      mockGetTenantReaderIconPolicyApi.mockResolvedValueOnce({
        policy: ReaderIconPolicy.UNSPECIFIED,
      });

      const { getTenantReaderIconPolicy } =
        await import("./reader-icon-settings");

      expect(await getTenantReaderIconPolicy("TENANT001", "en")).toEqual({
        message:
          "Could not load the reader icon policy. Please try again later.",
        ok: false,
        requiresSignIn: false,
      });
      expect(mockCacheLife).toHaveBeenCalledWith(UNSTORABLE);
    });

    it("reports a rejected session as one to sign in again for", async () => {
      mockGetTenantReaderIconPolicyApi.mockRejectedValueOnce(
        new ConnectError("expired", Code.Unauthenticated)
      );

      const { getTenantReaderIconPolicy } =
        await import("./reader-icon-settings");

      const result = await getTenantReaderIconPolicy("TENANT001", "en");

      expect(result).toMatchObject({ ok: false, requiresSignIn: true });
      expect(mockCacheLife).toHaveBeenCalledWith(UNSTORABLE);
    });
  });

  describe("listReaderIconPresets", () => {
    it("maps each preset with the variants that can be drawn", async () => {
      mockListReaderIconPresetsApi.mockResolvedValueOnce({
        presets: [
          {
            createdAt: "2026-10-15T00:00:00Z",
            id: "preset-1",
            variants: [
              {
                contentType: "image/webp",
                fileSizeBytes: 2048n,
                height: 256,
                label: "original",
                url: "/images/reader-icon-presets/preset-1",
                width: 256,
              },
              {
                contentType: "image/webp",
                fileSizeBytes: 0n,
                height: 0,
                label: "broken",
                url: "",
                width: 0,
              },
            ],
          },
        ],
      });

      const { listReaderIconPresets } = await import("./reader-icon-settings");

      expect(await listReaderIconPresets("TENANT001", "en")).toEqual({
        ok: true,
        presets: [
          {
            id: "preset-1",
            variants: [
              {
                contentType: "image/webp",
                fileSizeBytes: 2048,
                height: 256,
                label: "original",
                url: "/images/reader-icon-presets/preset-1",
                width: 256,
              },
            ],
          },
        ],
      });
      expect(mockCacheTag).toHaveBeenCalledWith(
        "tenant:TENANT001:reader-icon-presets"
      );
    });

    it("reports a failed read without a list", async () => {
      mockListReaderIconPresetsApi.mockRejectedValueOnce(
        new ConnectError("down", Code.Unavailable)
      );

      const { listReaderIconPresets } = await import("./reader-icon-settings");

      const result = await listReaderIconPresets("TENANT001", "en");

      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty("presets");
      expect(mockCacheLife).toHaveBeenCalledWith(UNSTORABLE);
    });
  });

  describe("updateTenantReaderIconPolicy", () => {
    it("sends the policy as the API's enum and answers what was stored", async () => {
      mockUpdateTenantReaderIconPolicyApi.mockResolvedValueOnce({
        policy: ReaderIconPolicy.DISABLED,
      });

      const { updateTenantReaderIconPolicy } =
        await import("./reader-icon-settings");

      expect(
        await updateTenantReaderIconPolicy(
          { policy: "disabled", tenantId: " TENANT001 " },
          "en"
        )
      ).toEqual({ ok: true, policy: "disabled" });
      expect(mockUpdateTenantReaderIconPolicyApi).toHaveBeenCalledWith(
        {
          policy: ReaderIconPolicy.DISABLED,
          tenant: { tenantId: "TENANT001" },
        },
        { headers: { Authorization: "Bearer session-token" } }
      );
    });
  });

  describe("uploadReaderIconPreset", () => {
    const input = {
      iconContentType: "image/png",
      iconData: new Uint8Array([1, 2, 3]),
      tenantId: "TENANT001",
    };

    it("sends the image for the tenant", async () => {
      mockUploadReaderIconPresetApi.mockResolvedValueOnce({});

      const { uploadReaderIconPreset } = await import("./reader-icon-settings");

      expect(await uploadReaderIconPreset(input, "en")).toEqual({ ok: true });
      expect(mockUploadReaderIconPresetApi).toHaveBeenCalledWith(
        {
          iconContentType: "image/png",
          iconData: input.iconData,
          tenant: { tenantId: "TENANT001" },
        },
        { headers: { Authorization: "Bearer session-token" } }
      );
    });

    it("says the tenant holds as many presets as it may", async () => {
      mockUploadReaderIconPresetApi.mockRejectedValueOnce(
        reasonError(Code.FailedPrecondition, "READER_ICON_PRESET_LIMIT")
      );

      const { uploadReaderIconPreset } = await import("./reader-icon-settings");

      expect(await uploadReaderIconPreset(input, "en")).toEqual({
        message:
          "This tenant has 50 preset icons, the most it can hold. Delete one to add another.",
        ok: false,
      });
    });

    it("says the platform has no object store yet", async () => {
      mockUploadReaderIconPresetApi.mockRejectedValueOnce(
        reasonError(Code.FailedPrecondition, "STORAGE_NOT_CONFIGURED")
      );

      const { uploadReaderIconPreset } = await import("./reader-icon-settings");

      expect(await uploadReaderIconPreset(input, "en")).toEqual({
        message: STORAGE_NOT_CONFIGURED,
        ok: false,
      });
    });
  });

  describe("deleteReaderIconPreset", () => {
    it("deletes the preset of the tenant", async () => {
      mockDeleteReaderIconPresetApi.mockResolvedValueOnce({});

      const { deleteReaderIconPreset } = await import("./reader-icon-settings");

      expect(
        await deleteReaderIconPreset(
          { presetId: "preset-1", tenantId: "TENANT001" },
          "en"
        )
      ).toEqual({ ok: true });
      expect(mockDeleteReaderIconPresetApi).toHaveBeenCalledWith(
        { presetId: "preset-1", tenant: { tenantId: "TENANT001" } },
        { headers: { Authorization: "Bearer session-token" } }
      );
    });

    it("says a preset already gone was deleted", async () => {
      mockDeleteReaderIconPresetApi.mockRejectedValueOnce(
        new ConnectError("missing", Code.NotFound)
      );

      const { deleteReaderIconPreset } = await import("./reader-icon-settings");

      expect(
        await deleteReaderIconPreset(
          { presetId: "preset-1", tenantId: "TENANT001" },
          "en"
        )
      ).toEqual({
        message:
          "This preset icon has already been deleted. Reload the page to see the current list.",
        ok: false,
      });
    });
  });
});
