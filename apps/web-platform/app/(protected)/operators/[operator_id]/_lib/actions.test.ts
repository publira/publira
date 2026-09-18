import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockDeactivatePlatformOperator,
  mockGetPlatformCurrentOperator,
  mockGetPlatformLocale,
  mockRedirect,
  mockSuspendPlatformOperator,
  mockUnsuspendPlatformOperator,
  mockUpdatePlatformOperatorRole,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockDeactivatePlatformOperator: vi.fn(),
  mockGetPlatformCurrentOperator: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockSuspendPlatformOperator: vi.fn(),
  mockUnsuspendPlatformOperator: vi.fn(),
  mockUpdatePlatformOperatorRole: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/auth", () => ({
  getPlatformCurrentOperator: mockGetPlatformCurrentOperator,
}));

vi.mock("#lib/auth-session", () => ({
  redirectToLoginIfSessionRejected: vi.fn(),
  withPlatformSessionReauth: <T>(operation: () => Promise<T>) => operation(),
}));

vi.mock("#lib/locale", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, getPlatformLocale: mockGetPlatformLocale };
});

vi.mock("#lib/operators", () => ({
  deactivatePlatformOperator: mockDeactivatePlatformOperator,
  platformOperatorsCacheTag: "platform:operators",
  suspendPlatformOperator: mockSuspendPlatformOperator,
  unsuspendPlatformOperator: mockUnsuspendPlatformOperator,
  updatePlatformOperatorRole: mockUpdatePlatformOperatorRole,
}));

vi.mock("#lib/dashboard", () => ({
  platformDashboardCacheTag: "platform:dashboard",
}));

vi.mock("#lib/audit-logs", () => ({
  platformAuditLogsCacheTag: "platform:audit-logs",
}));

const clearedTags = (): string[] =>
  mockUpdateTag.mock.calls.map(([tag]) => tag as string);

describe("operator detail actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetPlatformLocale.mockResolvedValue("en");
    mockGetPlatformCurrentOperator.mockResolvedValue({
      ok: true,
      operator: {
        name: "Taylor Reed",
        publicId: "OPERATOR001",
        role: "platform_super_admin",
      },
    });
  });

  it("changing a role clears the operators, the dashboard's role grants, and the audit log", async () => {
    mockUpdatePlatformOperatorRole.mockResolvedValueOnce({ ok: true });

    const { updateOperatorRoleAction } = await import("./actions");

    const formData = new FormData();
    formData.set("operator_public_id", "OPERATOR002");
    formData.set("operator_role", "platform_auditor");
    await updateOperatorRoleAction(null, formData);

    expect(clearedTags()).toEqual([
      "platform:operators",
      "platform:dashboard",
      "platform:audit-logs",
    ]);
  });

  it("suspending or unsuspending an operator clears the operators and the audit log", async () => {
    const { suspendOperatorAction, unsuspendOperatorAction } =
      await import("./actions");

    await suspendOperatorAction("OPERATOR002");
    await unsuspendOperatorAction("OPERATOR002");

    const expected = ["platform:operators", "platform:audit-logs"];
    expect(clearedTags()).toEqual([...expected, ...expected]);
  });

  it("deactivating an operator clears the operators, the dashboard, and the audit log before redirecting", async () => {
    const { deactivateOperatorAction } = await import("./actions");

    await expect(deactivateOperatorAction("OPERATOR002")).rejects.toThrow(
      "NEXT_REDIRECT:/operators"
    );

    expect(clearedTags()).toEqual([
      "platform:operators",
      "platform:dashboard",
      "platform:audit-logs",
    ]);
  });

  it("clears nothing when the operator may not make the change", async () => {
    const { suspendOperatorAction } = await import("./actions");

    await suspendOperatorAction("OPERATOR001");

    expect(mockSuspendPlatformOperator).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
