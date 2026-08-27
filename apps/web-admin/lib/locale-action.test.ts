import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAssertSameOrigin, mockCookies, mockSet } = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCookies: vi.fn(),
  mockSet: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("./csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

const formData = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};

const importAction = () => import("./locale-action");

const importOptions = async () => {
  const localeModule = await import("./locale");

  return localeModule.adminLocaleCookieOptions;
};

describe("setAdminLocaleAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockCookies.mockResolvedValue({ set: mockSet });
  });

  it("stores a supported locale in the cookie", async () => {
    const { setAdminLocaleAction } = await importAction();

    await setAdminLocaleAction(formData({ locale: "en" }));

    // The whole option object, so `sameSite` / `path` / `maxAge` / `httpOnly`
    // cannot drift between the Action and the contract pinned in locale.test.ts.
    expect(mockSet).toHaveBeenCalledWith(
      "publira_locale",
      "en",
      await importOptions()
    );
  });

  it("stores ja as an explicit choice rather than clearing the cookie", async () => {
    const { setAdminLocaleAction } = await importAction();

    await setAdminLocaleAction(formData({ locale: "ja" }));

    expect(mockSet).toHaveBeenCalledWith(
      "publira_locale",
      "ja",
      expect.anything()
    );
  });

  it.each([["fr"], ["ja-JP"], [""], ["<script>"]])(
    "ignores the forged value %j instead of writing it",
    async (locale) => {
      const { setAdminLocaleAction } = await importAction();

      await setAdminLocaleAction(formData({ locale }));

      expect(mockSet).not.toHaveBeenCalled();
    }
  );

  it("ignores a submission with no locale field", async () => {
    const { setAdminLocaleAction } = await importAction();

    await setAdminLocaleAction(formData({}));

    expect(mockSet).not.toHaveBeenCalled();
  });
});
