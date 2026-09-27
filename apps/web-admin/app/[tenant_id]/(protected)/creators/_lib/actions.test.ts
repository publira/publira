import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockLinkCreatorAccount,
  mockUnlinkCreatorAccount,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockLinkCreatorAccount: vi.fn(),
  mockUnlinkCreatorAccount: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/auth-session", () => ({
  withAdminSessionReauth: (run: () => Promise<unknown>) => run(),
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/creator", () => ({
  createCreator: vi.fn(),
  linkCreatorAccount: mockLinkCreatorAccount,
  unlinkCreatorAccount: mockUnlinkCreatorAccount,
  updateCreator: vi.fn(),
}));

const creatorId = "018f0e6a-2000-7000-8000-000000000001";
const readerId = "018f0e6a-5000-7000-8000-000000000001";

const readerOne = {
  createdAt: "2026-01-01T00:00:00Z",
  email: "one@example.com",
  id: readerId,
  linkedAt: "2026-09-01T00:00:00Z",
  name: "Reader One",
  publicId: "READER001",
  status: "active",
};

const formData = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  data.set("tenant_id", "TENANT001");
  data.set("creator_id", creatorId);
  data.set("creator_public_id", "CREATOR001");
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("linkCreatorAccountAction", () => {
  it("links the chosen reader and names them in the answer", async () => {
    mockLinkCreatorAccount.mockResolvedValueOnce({
      accounts: [readerOne],
      ok: true,
    });
    const { linkCreatorAccountAction } = await import("./actions");

    const result = await linkCreatorAccountAction(
      null,
      formData({ reader_id: readerId })
    );

    expect(result).toEqual({ message: "Linked Reader One.", ok: true });
    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockLinkCreatorAccount).toHaveBeenCalledWith(
      { creatorId, readerId, tenantId: "TENANT001" },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("creator-TENANT001-CREATOR001");
  });

  it("asks for a reader before anything is sent", async () => {
    const { linkCreatorAccountAction } = await import("./actions");

    const result = await linkCreatorAccountAction(
      null,
      formData({ reader_id: "" })
    );

    expect(result).toEqual({
      message: "Select a reader account.",
      ok: false,
    });
    expect(mockLinkCreatorAccount).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("passes on what the API refused and clears nothing", async () => {
    mockLinkCreatorAccount.mockResolvedValueOnce({
      message:
        "Only an active reader who has confirmed their email address can be linked.",
      ok: false,
    });
    const { linkCreatorAccountAction } = await import("./actions");

    const result = await linkCreatorAccountAction(
      null,
      formData({ reader_id: readerId })
    );

    expect(result).toEqual({
      message:
        "Only an active reader who has confirmed their email address can be linked.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("unlinkCreatorAccountAction", () => {
  it("unlinks the reader and clears the creator's page", async () => {
    mockUnlinkCreatorAccount.mockResolvedValueOnce({ accounts: [], ok: true });
    const { unlinkCreatorAccountAction } = await import("./actions");

    const result = await unlinkCreatorAccountAction(
      null,
      formData({ reader_id: readerId })
    );

    expect(result).toEqual({ message: "Account unlinked.", ok: true });
    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockUnlinkCreatorAccount).toHaveBeenCalledWith(
      { creatorId, readerId, tenantId: "TENANT001" },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("creator-TENANT001-CREATOR001");
  });

  it("refuses a reader ID that is not one", async () => {
    const { unlinkCreatorAccountAction } = await import("./actions");

    const result = await unlinkCreatorAccountAction(
      null,
      formData({ reader_id: "READER001" })
    );

    expect(result).toEqual({
      message: "Select a reader account.",
      ok: false,
    });
    expect(mockUnlinkCreatorAccount).not.toHaveBeenCalled();
  });
});
