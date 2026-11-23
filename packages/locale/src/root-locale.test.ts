import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockNotFound, mockRootLocale } = vi.hoisted(() => ({
  mockNotFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  mockRootLocale: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mockNotFound }));

vi.mock("next/root-params", () => ({ locale: mockRootLocale }));

const importLocale = () => import("./root-locale");

describe("getLocale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the locale the root segment names", async () => {
    mockRootLocale.mockResolvedValue("en");
    const { getLocale } = await importLocale();

    await expect(getLocale()).resolves.toBe("en");
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it.each(["fr", "ja-JP", ""])(
    "answers 404 for a segment that names no supported locale (%j)",
    async (segment) => {
      mockRootLocale.mockResolvedValue(segment);
      const { getLocale } = await importLocale();

      await expect(getLocale()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(mockNotFound).toHaveBeenCalledOnce();
    }
  );

  it("answers 404 when the segment carries no value at all", async () => {
    mockRootLocale.mockResolvedValue(undefined);
    const { getLocale } = await importLocale();

    await expect(getLocale()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
