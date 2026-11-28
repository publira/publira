import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as LocaleModule from "#lib/locale";

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
  mockUpdateTag: vi.fn<(tag: string) => void>(),
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
  const actual = await importOriginal<typeof LocaleModule>();

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
  mockUpdateTag.mock.calls.map(([tag]) => tag);

const otherOperator = {
  id: "0199a3c0-0000-7000-8000-000000000002",
  publicId: "OPERATOR002",
};

const targetForm = (target: { id: string; publicId: string }): FormData => {
  const formData = new FormData();
  formData.set("operator_id", target.id);
  formData.set("operator_public_id", target.publicId);

  return formData;
};

const self = {
  id: "0199a3c0-0000-7000-8000-000000000001",
  publicId: "OPERATOR001",
};

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

    const formData = targetForm(otherOperator);
    formData.set("operator_role", "platform_auditor");
    await updateOperatorRoleAction(null, formData);

    expect(mockUpdatePlatformOperatorRole).toHaveBeenCalledWith({
      locale: "en",
      operatorId: "0199a3c0-0000-7000-8000-000000000002",
      role: "platform_auditor",
    });

    expect(clearedTags()).toEqual([
      "platform:operators",
      "platform:dashboard",
      "platform:audit-logs",
    ]);
  });

  it("suspending or unsuspending an operator clears the operators and the audit log", async () => {
    mockSuspendPlatformOperator.mockResolvedValueOnce({ ok: true });
    mockUnsuspendPlatformOperator.mockResolvedValueOnce({ ok: true });

    const { suspendOperatorAction, unsuspendOperatorAction } =
      await import("./actions");

    await expect(
      suspendOperatorAction(null, targetForm(otherOperator))
    ).resolves.toEqual({ message: "", ok: true });
    await expect(
      unsuspendOperatorAction(null, targetForm(otherOperator))
    ).resolves.toEqual({ message: "", ok: true });

    expect(mockSuspendPlatformOperator).toHaveBeenCalledWith(
      otherOperator.id,
      "en"
    );
    expect(mockUnsuspendPlatformOperator).toHaveBeenCalledWith(
      otherOperator.id,
      "en"
    );

    const expected = ["platform:operators", "platform:audit-logs"];
    expect(clearedTags()).toEqual([...expected, ...expected]);
  });

  it("deactivating an operator clears the operators, the dashboard, and the audit log before redirecting", async () => {
    mockDeactivatePlatformOperator.mockResolvedValueOnce({ ok: true });

    const { deactivateOperatorAction } = await import("./actions");

    await expect(
      deactivateOperatorAction(null, targetForm(otherOperator))
    ).rejects.toThrow("NEXT_REDIRECT:/operators");

    expect(clearedTags()).toEqual([
      "platform:operators",
      "platform:dashboard",
      "platform:audit-logs",
    ]);
  });

  it.each([
    ["suspendOperatorAction", mockSuspendPlatformOperator],
    ["unsuspendOperatorAction", mockUnsuspendPlatformOperator],
    ["deactivateOperatorAction", mockDeactivatePlatformOperator],
  ] as const)(
    "%s answers with the refusal the API met, clears nothing, and stays on the page",
    async (name, mockChange) => {
      mockChange.mockResolvedValueOnce({
        message: "The account is not in a status this change starts from.",
        ok: false,
      });

      const actions = await import("./actions");

      await expect(
        actions[name](null, targetForm(otherOperator))
      ).resolves.toEqual({
        message: "The account is not in a status this change starts from.",
        ok: false,
      });
      expect(mockUpdateTag).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["suspendOperatorAction", mockSuspendPlatformOperator],
    ["unsuspendOperatorAction", mockUnsuspendPlatformOperator],
    ["deactivateOperatorAction", mockDeactivatePlatformOperator],
  ] as const)(
    "%s says an operator who is not a super admin may not make the change",
    async (name, mockChange) => {
      mockGetPlatformCurrentOperator.mockResolvedValue({
        ok: true,
        operator: {
          name: "Morgan Diaz",
          publicId: "OPERATOR003",
          role: "platform_operator",
        },
      });

      const actions = await import("./actions");

      await expect(
        actions[name](null, targetForm(otherOperator))
      ).resolves.toEqual({
        message:
          "You do not have permission to perform this action. Go back or use an account that does.",
        ok: false,
      });
      expect(mockChange).not.toHaveBeenCalled();
      expect(mockUpdateTag).not.toHaveBeenCalled();
    }
  );

  it("says an operator cannot suspend or deactivate their own account", async () => {
    const { deactivateOperatorAction, suspendOperatorAction } =
      await import("./actions");

    await expect(
      suspendOperatorAction(null, targetForm(self))
    ).resolves.toEqual({
      message: "You cannot suspend your own account.",
      ok: false,
    });
    await expect(
      deactivateOperatorAction(null, targetForm(self))
    ).resolves.toEqual({
      message: "You cannot deactivate your own account.",
      ok: false,
    });

    expect(mockSuspendPlatformOperator).not.toHaveBeenCalled();
    expect(mockDeactivatePlatformOperator).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("sends no request for an operator ID that is not a UUID", async () => {
    const { suspendOperatorAction } = await import("./actions");

    const result = await suspendOperatorAction(
      null,
      targetForm({ id: "OPERATOR002", publicId: "OPERATOR002" })
    );

    expect(result?.ok).toBe(false);
    expect(mockSuspendPlatformOperator).not.toHaveBeenCalled();
  });
});
