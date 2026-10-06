import { bindMessages } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockListReaders } = vi.hoisted(() => ({
  mockListReaders: vi.fn(),
}));

vi.mock("./messages", () => ({
  getMessagesFor: () =>
    Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
}));

vi.mock("./auth-session", () => ({
  redirectToLoginIfSessionRejected: () => Promise.resolve(),
  withAdminSessionReauth: (run: () => Promise<unknown>) => run(),
}));

vi.mock("./reader", () => ({
  listReaders: mockListReaders,
}));

describe("listReaderOptionsAction", () => {
  beforeEach(() => {
    mockListReaders.mockReset();
    mockListReaders.mockResolvedValue({ ok: true, readers: [] });
  });

  it("searches the active readers with the trimmed query", async () => {
    const { listReaderOptionsAction } = await import("./reader-options-action");

    await listReaderOptionsAction("TENANT001", "  one  ", "en");

    expect(mockListReaders).toHaveBeenCalledWith("TENANT001", "en", {
      limit: 20,
      query: "one",
      status: "active",
    });
  });

  it("refuses a query longer than an email address before it is searched", async () => {
    const { listReaderOptionsAction } = await import("./reader-options-action");

    const result = await listReaderOptionsAction(
      "TENANT001",
      "a".repeat(255),
      "en"
    );

    expect(result).toEqual({
      message: "Shorten the search to 254 characters or fewer.",
      ok: false,
      readers: [],
    });
    expect(mockListReaders).not.toHaveBeenCalled();
  });

  it("refuses a value that is not a string", async () => {
    const { listReaderOptionsAction } = await import("./reader-options-action");

    const result = await listReaderOptionsAction(
      "TENANT001",
      42 as unknown as string,
      "en"
    );

    expect(result.ok).toBe(false);
    expect(mockListReaders).not.toHaveBeenCalled();
  });
});
