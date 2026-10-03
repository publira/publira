import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockModerateReader,
  mockRedirect,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockModerateReader: vi.fn(),
  mockRedirect: vi.fn(),
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
