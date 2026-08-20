import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCookies, mockSet } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockSet: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

const formData = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};

const importAction = () => import("./locale-action");

describe("setPlatformLocaleAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockCookies.mockResolvedValue({ set: mockSet });
  });

  it("stores a supported locale in the cookie", async () => {
    const { setPlatformLocaleAction } = await importAction();

    await setPlatformLocaleAction(formData({ locale: "en" }));

    expect(mockSet).toHaveBeenCalledWith(
      "publira_locale",
      "en",
      expect.objectContaining({ maxAge: 31_536_000, path: "/" })
    );
  });

  it("stores ja as an explicit choice rather than clearing the cookie", async () => {
    const { setPlatformLocaleAction } = await importAction();

    await setPlatformLocaleAction(formData({ locale: "ja" }));

    expect(mockSet).toHaveBeenCalledWith(
      "publira_locale",
      "ja",
      expect.anything()
    );
  });

  it.each([["fr"], ["ja-JP"], [""], ["<script>"]])(
    "ignores the forged value %j instead of writing it",
    async (locale) => {
      const { setPlatformLocaleAction } = await importAction();

      await setPlatformLocaleAction(formData({ locale }));

      expect(mockSet).not.toHaveBeenCalled();
    }
  );

  it("ignores a submission with no locale field", async () => {
    const { setPlatformLocaleAction } = await importAction();

    await setPlatformLocaleAction(formData({}));

    expect(mockSet).not.toHaveBeenCalled();
  });
});
