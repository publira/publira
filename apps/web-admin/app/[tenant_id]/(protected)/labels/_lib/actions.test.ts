import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockRedirect,
  mockUpdateLabel,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockRedirect: vi.fn(),
  mockUpdateLabel: vi.fn(),
  mockUpdateTag: vi.fn(),
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

vi.mock("#lib/label", () => ({
  createLabel: vi.fn(),
  updateLabel: mockUpdateLabel,
  uploadLabelEyeCatchAspectImage: vi.fn(),
}));

vi.mock("#lib/series", () => ({
  seriesListCacheTag: (tenantId: string) => `series-list-${tenantId}`,
}));

const renameFormData = (): FormData => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("public_id", "LABEL001");
  formData.set("name", "Renamed label");
  formData.set("clear_eye_catch_image", "0");
  return formData;
};

describe("label actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // `withAdminSessionReauth` resolves the session before the mutation runs;
    // without a token every Action under test would redirect to /login.
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("renaming a label clears the series list, which names each row's label", async () => {
    mockUpdateLabel.mockResolvedValueOnce({
      label: {
        eyeCatchImageUpdatedAt: "",
        eyeCatchImageVariants: [],
        name: "Renamed label",
        publicId: "LABEL001",
      },
      ok: true,
    });

    const { updateLabelAction } = await import("./actions");
    const result = await updateLabelAction(null, renameFormData());

    expect(result?.ok).toBe(true);
    expect(mockUpdateTag).toHaveBeenCalledWith("labels-TENANT001");
    expect(mockUpdateTag).toHaveBeenCalledWith("label-TENANT001-LABEL001");
    expect(mockUpdateTag).toHaveBeenCalledWith("series-list-TENANT001");
  });

  it("a saved rename confirms the label was updated", async () => {
    mockUpdateLabel.mockResolvedValueOnce({
      label: {
        eyeCatchImageUpdatedAt: "",
        eyeCatchImageVariants: [],
        name: "Renamed label",
        publicId: "LABEL001",
      },
      ok: true,
    });

    const { updateLabelAction } = await import("./actions");
    const result = await updateLabelAction(null, renameFormData());

    expect(result?.message).toBe("Label updated.");
  });

  it("a saved eye-catch confirms the cover image was updated", async () => {
    mockUpdateLabel.mockResolvedValueOnce({
      label: {
        eyeCatchImageUpdatedAt: "2026-09-23T00:00:00Z",
        eyeCatchImageVariants: [],
        name: "Renamed label",
        publicId: "LABEL001",
      },
      ok: true,
    });

    const { updateLabelEyeCatchAction } = await import("./actions");
    const result = await updateLabelEyeCatchAction(null, renameFormData());

    expect(result?.message).toBe("Cover image updated.");
  });

  it("a rejected rename clears no cache", async () => {
    mockUpdateLabel.mockResolvedValueOnce({
      message: "The label could not be updated.",
      ok: false,
    });

    const { updateLabelAction } = await import("./actions");
    const result = await updateLabelAction(null, renameFormData());

    expect(result?.ok).toBe(false);
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
