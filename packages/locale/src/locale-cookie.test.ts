import { LOCALE_COOKIE_NAME } from "@publira/i18n";
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

const importCookie = () => import("./locale-cookie");

describe("locale cookie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue({ set: mockSet });
  });

  it("is a long-lived, root-scoped, lax cookie the inline script can read", async () => {
    const { localeCookieOptions } = await importCookie();

    expect(localeCookieOptions).toMatchObject({
      httpOnly: false,
      maxAge: 31_536_000,
      path: "/",
      sameSite: "lax",
    });
  });

  it("stores a supported locale", async () => {
    const { localeCookieOptions, persistLocaleChoice } = await importCookie();

    await persistLocaleChoice(formData({ locale: "en" }));

    expect(mockSet).toHaveBeenCalledWith(
      LOCALE_COOKIE_NAME,
      "en",
      localeCookieOptions
    );
  });

  it("stores ja as an explicit choice", async () => {
    const { persistLocaleChoice } = await importCookie();

    await persistLocaleChoice(formData({ locale: "ja" }));

    expect(mockSet).toHaveBeenCalledWith(
      LOCALE_COOKIE_NAME,
      "ja",
      expect.anything()
    );
  });

  it.each([["fr"], ["ja-JP"], [""], ["<script>"]])(
    "drops the forged value %j",
    async (locale) => {
      const { persistLocaleChoice } = await importCookie();

      await persistLocaleChoice(formData({ locale }));

      expect(mockSet).not.toHaveBeenCalled();
    }
  );

  it("drops a submission with no locale field", async () => {
    const { persistLocaleChoice } = await importCookie();

    await persistLocaleChoice(formData({}));

    expect(mockSet).not.toHaveBeenCalled();
  });
});
