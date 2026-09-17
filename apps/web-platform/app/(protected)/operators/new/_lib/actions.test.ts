import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreatePlatformOperator,
  mockGetPlatformLocale,
  mockRedirect,
  mockResolveAccessToken,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreatePlatformOperator: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockResolveAccessToken: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("#lib/locale", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, getPlatformLocale: mockGetPlatformLocale };
});

vi.mock("#lib/operators", () => ({
  createPlatformOperator: mockCreatePlatformOperator,
  platformOperatorsCacheTag: "platform:operators",
}));

vi.mock("#lib/dashboard", () => ({
  platformDashboardCacheTag: "platform:dashboard",
}));

vi.mock("#lib/audit-logs", () => ({
  platformAuditLogsCacheTag: "platform:audit-logs",
}));

const operatorFormData = (): FormData => {
  const formData = new FormData();
  formData.set("operator_email", "new.operator@example.com");
  formData.set("operator_name", "Jordan Lee");
  formData.set("operator_role", "platform_operator");
  return formData;
};

describe("createOperatorAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // `withPlatformSessionReauth` resolves the session before the mutation
    // runs; without a token the Action would redirect to /login instead.
    mockResolveAccessToken.mockResolvedValue("session-token");
    mockGetPlatformLocale.mockResolvedValue("en");
  });

  it("clears the operators, the dashboard, and the audit log before returning to the list", async () => {
    mockCreatePlatformOperator.mockResolvedValueOnce({ ok: true });

    const { createOperatorAction } = await import("./actions");

    await expect(
      createOperatorAction(null, operatorFormData())
    ).rejects.toThrow("NEXT_REDIRECT:/operators");
    expect(mockUpdateTag.mock.calls.map(([tag]) => tag)).toEqual([
      "platform:operators",
      "platform:dashboard",
      "platform:audit-logs",
    ]);
  });

  it("clears nothing and stays on the form when the creation fails", async () => {
    mockCreatePlatformOperator.mockResolvedValueOnce({
      message: "Could not create the operator.",
      ok: false,
    });

    const { createOperatorAction } = await import("./actions");

    await expect(
      createOperatorAction(null, operatorFormData())
    ).resolves.toEqual({
      message: "Could not create the operator.",
      ok: false,
    });
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
