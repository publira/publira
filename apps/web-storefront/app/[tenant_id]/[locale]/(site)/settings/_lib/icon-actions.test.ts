import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockDeleteMyIcon,
  mockSelectMyIcon,
  mockUpdateTag,
  mockUploadMyIcon,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockDeleteMyIcon: vi.fn(),
  mockSelectMyIcon: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUploadMyIcon: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("#lib/auth", () => ({
  accountCacheTag: (tenantId: string) => `tenant:${tenantId}:account`,
  deleteMyIcon: mockDeleteMyIcon,
  selectMyIcon: mockSelectMyIcon,
  uploadMyIcon: mockUploadMyIcon,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

const { removeIconAction, selectIconAction, uploadIconAction } =
  await import("./icon-actions");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_TAG = `tenant:${TENANT_ID}:account`;

const png = () =>
  new File([new Uint8Array([1, 2, 3])], "icon.png", { type: "image/png" });

const form = (
  fields: Record<string, Blob | string> = {},
  { icon = png() }: { icon?: Blob | string | null } = {}
) => {
  const data = new FormData();

  for (const [name, value] of Object.entries({
    locale: "en",
    tenantId: TENANT_ID,
    ...fields,
  })) {
    data.set(name, value);
  }

  if (icon !== null) {
    data.set("icon", icon);
  }

  return data;
};

describe("uploadIconAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadMyIcon.mockResolvedValue({ me: null, ok: true });
  });

  it("sends the picked image and refreshes the account read", async () => {
    await expect(uploadIconAction(form())).resolves.toEqual({
      message: "Your icon has been updated.",
      ok: true,
    });
    expect(mockAssertSameOrigin).toHaveBeenCalledOnce();
    expect(mockUploadMyIcon).toHaveBeenCalledWith(TENANT_ID, {
      contentType: "image/png",
      data: new Uint8Array([1, 2, 3]),
    });
    expect(mockUpdateTag).toHaveBeenCalledWith(ACCOUNT_TAG);
  });

  it("words the outcome in the locale the screen is on", async () => {
    await expect(uploadIconAction(form({ locale: "ja" }))).resolves.toEqual({
      message: "アイコンを更新しました。",
      ok: true,
    });
  });

  it("sends nothing for a tenant id the form would never carry", async () => {
    await expect(
      uploadIconAction(form({ tenantId: "not-a-tenant" }))
    ).resolves.toMatchObject({ ok: false });
    expect(mockUploadMyIcon).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("sends nothing when the form carries no file", async () => {
    await expect(
      uploadIconAction(form({}, { icon: "not a file" }))
    ).resolves.toEqual({
      message: "This file cannot be used. Select a JPEG, PNG, or WebP image.",
      ok: false,
    });
    expect(mockUploadMyIcon).not.toHaveBeenCalled();
  });

  it("refuses a format the API cannot read before sending it on", async () => {
    const svg = new File([new Uint8Array([1])], "icon.svg", {
      type: "image/svg+xml",
    });

    await expect(uploadIconAction(form({}, { icon: svg }))).resolves.toEqual({
      message: "This file cannot be used. Select a JPEG, PNG, or WebP image.",
      ok: false,
    });
    expect(mockUploadMyIcon).not.toHaveBeenCalled();
  });

  it.each([
    [
      "image",
      "This image cannot be used as an icon. Select a JPEG, PNG, or WebP image no larger than 10MB and at least 128x128px.",
    ],
    [
      "storage-not-configured",
      "Icons cannot be uploaded on this site right now. Contact the site if this continues.",
    ],
    [
      "rate-limited",
      "Too many requests in a short time. Please wait a moment and try again.",
    ],
    [
      "unauthenticated",
      "Your session is no longer valid. Please sign in again.",
    ],
    ["unavailable", "Could not connect to the server. Please try again later."],
    ["precondition", "Could not update your icon. Please try again later."],
    [
      "not-allowed",
      "This site no longer allows this change to your icon. Reload the page.",
    ],
  ] as const)("shows the API's %s refusal", async (refusal, message) => {
    mockUploadMyIcon.mockResolvedValueOnce({ ok: false, refusal });

    await expect(uploadIconAction(form())).resolves.toEqual({
      message,
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("selectIconAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectMyIcon.mockResolvedValue({ me: null, ok: true });
  });

  it("shows the preset and refreshes the account read", async () => {
    await expect(
      selectIconAction(form({ presetId: "P1" }, { icon: null }))
    ).resolves.toEqual({ message: "Your icon has been updated.", ok: true });
    expect(mockAssertSameOrigin).toHaveBeenCalledOnce();
    expect(mockSelectMyIcon).toHaveBeenCalledWith(TENANT_ID, "P1");
    expect(mockUpdateTag).toHaveBeenCalledWith(ACCOUNT_TAG);
  });

  it("sends nothing when the form names no preset", async () => {
    await expect(
      selectIconAction(form({ presetId: " " }, { icon: null }))
    ).resolves.toEqual({
      message: "Could not update your icon. Please try again later.",
      ok: false,
    });
    expect(mockSelectMyIcon).not.toHaveBeenCalled();
  });

  it.each([
    [
      "not-found",
      "This icon is no longer available. Reload the page and choose another.",
    ],
    [
      "not-allowed",
      "This site no longer allows this change to your icon. Reload the page.",
    ],
    ["precondition", "Could not update your icon. Please try again later."],
  ] as const)("shows the API's %s refusal", async (refusal, message) => {
    mockSelectMyIcon.mockResolvedValueOnce({ ok: false, refusal });

    await expect(
      selectIconAction(form({ presetId: "P1" }, { icon: null }))
    ).resolves.toEqual({ message, ok: false });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("removeIconAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteMyIcon.mockResolvedValue({ me: null, ok: true });
  });

  it("removes the icon and refreshes the account read", async () => {
    await expect(removeIconAction(form({}, { icon: null }))).resolves.toEqual({
      message: "Your icon has been removed.",
      ok: true,
    });
    expect(mockAssertSameOrigin).toHaveBeenCalledOnce();
    expect(mockDeleteMyIcon).toHaveBeenCalledWith(TENANT_ID);
    expect(mockUpdateTag).toHaveBeenCalledWith(ACCOUNT_TAG);
  });

  it("words a refusal with no shared copy as a failed removal", async () => {
    mockDeleteMyIcon.mockResolvedValueOnce({
      ok: false,
      refusal: "precondition",
    });

    await expect(removeIconAction(form({}, { icon: null }))).resolves.toEqual({
      message: "Could not remove your icon. Please try again later.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
