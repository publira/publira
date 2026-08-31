import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreateInitialUser,
  mockGetInitialLocaleCandidate,
  mockRedirect,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreateInitialUser: vi.fn(),
  mockGetInitialLocaleCandidate: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/setup", () => ({ createInitialUser: mockCreateInitialUser }));

vi.mock("#lib/initial-locale", () => ({
  getInitialLocaleCandidate: mockGetInitialLocaleCandidate,
}));

const setupFormData = (overrides: Record<string, string> = {}): FormData => {
  const fields = {
    confirmPassword: "correct-horse-battery",
    default_locale: "en",
    email: "admin@example.com",
    name: "Admin User",
    password: "correct-horse-battery",
    ...overrides,
  };

  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
};

describe("setupAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Deliberately not the locale the fixture submits: what gets saved is the
    // operator's pick, and the header only decided which option opened
    // selected.
    mockGetInitialLocaleCandidate.mockResolvedValue("ja");
  });

  it("saves the locale chosen on the form rather than the negotiated one", async () => {
    mockCreateInitialUser.mockResolvedValueOnce({ ok: true });

    const { setupAction } = await import("./actions");

    await expect(setupAction(null, setupFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/login?setup=done"
    );
    expect(mockCreateInitialUser).toHaveBeenCalledWith({
      defaultLocale: "en",
      email: "admin@example.com",
      // The failure copy follows the screen, which renders in the negotiated
      // locale; only `defaultLocale` is the operator's choice.
      locale: "ja",
      name: "Admin User",
      password: "correct-horse-battery",
    });
  });

  it("saves ja when that is what the operator picked", async () => {
    mockGetInitialLocaleCandidate.mockResolvedValue("en");
    mockCreateInitialUser.mockResolvedValueOnce({ ok: true });

    const { setupAction } = await import("./actions");

    await expect(
      setupAction(null, setupFormData({ default_locale: "ja" }))
    ).rejects.toThrow("NEXT_REDIRECT:/login?setup=done");
    expect(mockCreateInitialUser).toHaveBeenCalledWith(
      expect.objectContaining({ defaultLocale: "ja" })
    );
  });

  it("rejects a locale outside the supported list without calling the API", async () => {
    const { setupAction } = await import("./actions");

    const result = await setupAction(
      null,
      setupFormData({ default_locale: "fr" })
    );

    expect(result?.ok).toBe(false);
    expect(mockCreateInitialUser).not.toHaveBeenCalled();
  });

  it("rejects a submission that carries no locale at all", async () => {
    const formData = setupFormData();
    formData.delete("default_locale");

    const { setupAction } = await import("./actions");

    const result = await setupAction(null, formData);

    expect(result?.ok).toBe(false);
    expect(mockCreateInitialUser).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords before saving anything", async () => {
    const { setupAction } = await import("./actions");

    const result = await setupAction(
      null,
      setupFormData({ confirmPassword: "something-else" })
    );

    expect(result?.ok).toBe(false);
    expect(mockCreateInitialUser).not.toHaveBeenCalled();
  });

  it("sends an already-completed setup to the sign-in screen", async () => {
    mockCreateInitialUser.mockResolvedValueOnce({
      alreadyCompleted: true,
      message: "Setup is already complete.",
      ok: false,
    });

    const { setupAction } = await import("./actions");

    await expect(setupAction(null, setupFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/login"
    );
  });
});
