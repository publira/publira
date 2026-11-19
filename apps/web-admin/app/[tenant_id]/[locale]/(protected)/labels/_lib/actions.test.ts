import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as AuthSessionModule from "#lib/auth-session";

const {
  mockAssertSameOrigin,
  mockDeleteLabel,
  mockGetAccessToken,
  mockGetLabelForTenant,
  mockRedirect,
  mockUpdateLabel,
  mockUpdateTag,
  mockVerifyAdminSession,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockDeleteLabel: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetLabelForTenant: vi.fn(),
  mockRedirect: vi.fn(),
  mockUpdateLabel: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockVerifyAdminSession: vi.fn(),
}));

vi.mock("#lib/auth-session", async (importOriginal) => ({
  ...(await importOriginal<typeof AuthSessionModule>()),
  verifyAdminSession: mockVerifyAdminSession,
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
  deleteLabel: mockDeleteLabel,
  getLabelForTenant: mockGetLabelForTenant,
  updateLabel: mockUpdateLabel,
  uploadLabelEyeCatchAspectImage: vi.fn(),
}));

vi.mock("#lib/promotion-code", () => ({
  promotionCodesCacheTag: (tenantId: string) => `promotion-codes-${tenantId}`,
}));

vi.mock("#lib/series", () => ({
  seriesListCacheTag: (tenantId: string) => `series-list-${tenantId}`,
}));

const renameFormData = (): FormData => {
  const formData = new FormData();
  formData.set("tenant_id", "TENANT001");
  formData.set("label_id", "018f0e6a-5000-7000-8000-000000000001");
  formData.set("name", "Renamed label");
  formData.set("clear_eye_catch_image", "0");

  return formData;
};

// Evaluating the Actions' module graph for the first time takes far longer than
// any test's own work, so it is paid here rather than inside one test's timeout.
beforeAll(async () => {
  await import("./actions");
});

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
        id: "018f0e6a-5000-7000-8000-000000000001",
        name: "Renamed label",
        publicId: "LABEL001",
      },
      ok: true,
    });

    const { updateLabelAction } = await import("./actions");
    const result = await updateLabelAction(null, renameFormData());

    expect(result?.ok).toBe(true);
    expect(mockUpdateTag).toHaveBeenCalledWith("labels-TENANT001");
    // The edit addresses the label by its ID; the detail page's cache is
    // filed under the public ID its URL names, which the answer carries.
    expect(mockUpdateLabel.mock.calls[0]?.[0]).toMatchObject({
      id: "018f0e6a-5000-7000-8000-000000000001",
    });
    expect(mockUpdateTag).toHaveBeenCalledWith("label-TENANT001-LABEL001");
    expect(mockUpdateTag).toHaveBeenCalledWith("series-list-TENANT001");
  });

  it("a saved rename confirms the label was updated", async () => {
    mockUpdateLabel.mockResolvedValueOnce({
      label: {
        eyeCatchImageUpdatedAt: "",
        eyeCatchImageVariants: [],
        id: "018f0e6a-5000-7000-8000-000000000001",
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
        id: "018f0e6a-5000-7000-8000-000000000001",
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

describe("deleteLabelAction", () => {
  const LABEL_ID = "018f0e6a-5000-7000-8000-000000000001";

  const deleteLabelForm = (nameConfirmation: string): FormData => {
    const formData = new FormData();
    formData.set("tenant_id", "TENANT001");
    formData.set("label_id", LABEL_ID);
    formData.set("label_public_id", "LABEL001");
    formData.set("name_confirmation", nameConfirmation);

    return formData;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
    mockGetLabelForTenant.mockResolvedValue({
      label: { id: LABEL_ID, name: "Harbor Press", publicId: "LABEL001" },
      ok: true,
    });
  });

  it("refuses a name that is not the label's without calling the API", async () => {
    const { deleteLabelAction } = await import("./actions");

    const result = await deleteLabelAction(
      null,
      deleteLabelForm("Harbor Press ")
    );

    expect(mockVerifyAdminSession).toHaveBeenCalledWith("TENANT001");
    expect(result).toEqual({
      message: "The name entered is not this label's name.",
      ok: false,
    });
    expect(mockDeleteLabel).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("refuses a label the URL does not name", async () => {
    mockGetLabelForTenant.mockResolvedValueOnce({
      label: {
        id: "018f0e6a-5000-7000-8000-000000000002",
        name: "Harbor Press",
        publicId: "LABEL001",
      },
      ok: true,
    });

    const { deleteLabelAction } = await import("./actions");

    const result = await deleteLabelAction(
      null,
      deleteLabelForm("Harbor Press")
    );

    expect(result).toEqual({
      message: "The label ID to update is missing.",
      ok: false,
    });
    expect(mockDeleteLabel).not.toHaveBeenCalled();
  });

  it("says a label deleted already is gone", async () => {
    mockGetLabelForTenant.mockResolvedValueOnce({ notFound: true, ok: false });

    const { deleteLabelAction } = await import("./actions");

    const result = await deleteLabelAction(
      null,
      deleteLabelForm("Harbor Press")
    );

    expect(result).toEqual({
      message:
        "This label has already been deleted. Go back to the label list.",
      ok: false,
    });
    expect(mockDeleteLabel).not.toHaveBeenCalled();
  });

  it("keeps a refusal and the screen it points to in the dialog", async () => {
    mockDeleteLabel.mockResolvedValueOnce({
      message: "This label cannot be deleted while a series is filed under it.",
      ok: false,
      reference: "series",
    });

    const { deleteLabelAction } = await import("./actions");

    const result = await deleteLabelAction(
      null,
      deleteLabelForm("Harbor Press")
    );

    expect(result).toEqual({
      message: "This label cannot be deleted while a series is filed under it.",
      ok: false,
      reference: "series",
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("deletes the label and names it to the label list", async () => {
    mockDeleteLabel.mockResolvedValueOnce({ ok: true });

    const { deleteLabelAction } = await import("./actions");
    await deleteLabelAction(null, deleteLabelForm("Harbor Press"));

    expect(mockDeleteLabel).toHaveBeenCalledWith(
      { id: LABEL_ID, tenantId: "TENANT001" },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("labels-TENANT001");
    expect(mockUpdateTag).toHaveBeenCalledWith("label-TENANT001-LABEL001");
    expect(mockUpdateTag).toHaveBeenCalledWith("promotion-codes-TENANT001");
    expect(mockRedirect).toHaveBeenCalledWith(
      "/labels?deleted=1&deleted_name=Harbor+Press"
    );
  });
});
