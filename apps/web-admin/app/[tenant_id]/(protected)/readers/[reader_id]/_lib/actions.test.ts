import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockModerateReader,
  mockRedirect,
  mockRemoveReaderIcon,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockModerateReader: vi.fn(),
  mockRedirect: vi.fn(),
  mockRemoveReaderIcon: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/auth-session", () => ({
  withAdminSessionReauth: (run: () => Promise<unknown>) => run(),
}));

vi.mock("#lib/reader", () => ({
  moderateReader: mockModerateReader,
  removeReaderIcon: mockRemoveReaderIcon,
  setReaderBirthDate: vi.fn(),
}));

vi.mock("#lib/tenant-members", () => ({
  tenantMembersCacheTag: (tenantId: string) => `tenant-members-${tenantId}`,
}));

const READER_ID = "01920000-0000-7000-8000-000000000001";

const readerForm = (): FormData => {
  const data = new FormData();
  data.set("tenant_id", "TENANT001");
  data.set("public_id", "READER00001");
  data.set("reader_id", READER_ID);

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

describe("reader moderation actions", () => {
  it.each([
    ["suspendReaderAction", "suspend", "/readers/READER00001?suspended=1"],
    [
      "unsuspendReaderAction",
      "unsuspend",
      "/readers/READER00001?unsuspended=1",
    ],
    ["deleteReaderAction", "delete", "/readers?deleted=1"],
  ] as const)(
    "%s clears the member list a staff account appears in",
    async (name, action, destination) => {
      mockModerateReader.mockResolvedValueOnce({ ok: true });
      const actions = await import("./actions");

      await actions[name](null, readerForm());

      expect(mockModerateReader).toHaveBeenCalledWith(
        { action, readerId: READER_ID, tenantId: "TENANT001" },
        "en"
      );
      expect(mockUpdateTag).toHaveBeenCalledWith("tenant-members-TENANT001");
      expect(mockRedirect).toHaveBeenCalledWith(destination);
    }
  );

  it("leaves the member list alone when the API refused", async () => {
    mockModerateReader.mockResolvedValueOnce({
      message: "This account is the tenant's last active tenant admin.",
      ok: false,
    });
    const { suspendReaderAction } = await import("./actions");

    const result = await suspendReaderAction(null, readerForm());

    expect(result).toEqual({
      message: "This account is the tenant's last active tenant admin.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe("removeReaderIconAction", () => {
  it("removes the icon and returns to the reader's page with its toast", async () => {
    mockRemoveReaderIcon.mockResolvedValueOnce({ ok: true });
    const { removeReaderIconAction } = await import("./actions");

    await removeReaderIconAction(null, readerForm());

    expect(mockAssertSameOrigin).toHaveBeenCalled();
    expect(mockRemoveReaderIcon).toHaveBeenCalledWith(
      { readerId: READER_ID, tenantId: "TENANT001" },
      "en"
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      "/readers/READER00001?icon_removed=1"
    );
  });

  it("shows the refusal beside the button and stays on the page", async () => {
    mockRemoveReaderIcon.mockResolvedValueOnce({
      message: "Could not remove the icon. Please try again later.",
      ok: false,
    });
    const { removeReaderIconAction } = await import("./actions");

    const result = await removeReaderIconAction(null, readerForm());

    expect(result).toEqual({
      message: "Could not remove the icon. Please try again later.",
      ok: false,
    });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("calls nothing for a form that names no reader", async () => {
    const data = readerForm();
    data.delete("reader_id");
    const { removeReaderIconAction } = await import("./actions");

    const result = await removeReaderIconAction(null, data);

    expect(result?.ok).toBe(false);
    expect(mockRemoveReaderIcon).not.toHaveBeenCalled();
  });
});
