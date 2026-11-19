import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockDeleteCreator,
  mockGetCreator,
  mockLinkCreatorAccount,
  mockRedirect,
  mockUnlinkCreatorAccount,
  mockUpdateTag,
  mockVerifyAdminSession,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockDeleteCreator: vi.fn(),
  mockGetCreator: vi.fn(),
  mockLinkCreatorAccount: vi.fn(),
  mockRedirect: vi.fn(),
  mockUnlinkCreatorAccount: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockVerifyAdminSession: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("#lib/auth-session", () => ({
  verifyAdminSession: mockVerifyAdminSession,
  withAdminSessionReauth: <T>(run: () => Promise<T>) => run(),
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/creator", () => ({
  createCreator: vi.fn(),
  deleteCreator: mockDeleteCreator,
  getCreator: mockGetCreator,
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

// Evaluating the Actions' module graph for the first time takes far longer than
// any test's own work, so it is paid here rather than inside one test's timeout.
beforeAll(async () => {
  await import("./actions");
});

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

const deleteForm = (nameConfirmation: string): FormData =>
  formData({ name_confirmation: nameConfirmation });

describe("deleteCreatorAction", () => {
  beforeEach(() => {
    mockGetCreator.mockResolvedValue({
      accounts: [],
      creator: { id: creatorId, name: "Mina Sato", publicId: "CREATOR001" },
      ok: true,
    });
  });

  it("refuses a name that is not the author's without calling the API", async () => {
    const { deleteCreatorAction } = await import("./actions");

    const result = await deleteCreatorAction(null, deleteForm("Mina Sato "));

    expect(mockVerifyAdminSession).toHaveBeenCalledWith("TENANT001");
    expect(result).toEqual({
      message: "The name entered is not this author's name.",
      ok: false,
    });
    expect(mockDeleteCreator).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("refuses an author the URL does not name", async () => {
    mockGetCreator.mockResolvedValueOnce({
      accounts: [],
      creator: {
        id: "018f0e6a-2000-7000-8000-000000000002",
        name: "Mina Sato",
        publicId: "CREATOR001",
      },
      ok: true,
    });
    const { deleteCreatorAction } = await import("./actions");

    const result = await deleteCreatorAction(null, deleteForm("Mina Sato"));

    expect(result).toEqual({
      message: "The author ID to update is missing.",
      ok: false,
    });
    expect(mockDeleteCreator).not.toHaveBeenCalled();
  });

  it("says an author deleted already is gone", async () => {
    mockGetCreator.mockResolvedValueOnce({ notFound: true, ok: false });
    const { deleteCreatorAction } = await import("./actions");

    const result = await deleteCreatorAction(null, deleteForm("Mina Sato"));

    expect(result).toEqual({
      message:
        "This author has already been deleted. Go back to the author list.",
      ok: false,
    });
    expect(mockDeleteCreator).not.toHaveBeenCalled();
  });

  it("keeps a refusal and the screen it points to in the dialog", async () => {
    const refusal = {
      message:
        "This author cannot be deleted while a series or an episode credits them.",
      ok: false,
      reference: "credits",
    };

    mockDeleteCreator.mockResolvedValueOnce(refusal);
    const { deleteCreatorAction } = await import("./actions");

    const result = await deleteCreatorAction(null, deleteForm("Mina Sato"));

    expect(result).toEqual(refusal);
    expect(mockUpdateTag).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("deletes the author and names them to the author list", async () => {
    mockDeleteCreator.mockResolvedValueOnce({ ok: true });
    const { deleteCreatorAction } = await import("./actions");

    await deleteCreatorAction(null, deleteForm("Mina Sato"));

    expect(mockDeleteCreator).toHaveBeenCalledWith(
      { id: creatorId, tenantId: "TENANT001" },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("creators-TENANT001");
    expect(mockUpdateTag).toHaveBeenCalledWith("creator-TENANT001-CREATOR001");
    expect(mockRedirect).toHaveBeenCalledWith(
      "/creators?deleted=1&deleted_name=Mina+Sato"
    );
  });
});
