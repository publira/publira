import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockDeletePlatformEndUser,
  mockGetPlatformCurrentOperator,
  mockGetPlatformLocale,
  mockRedirect,
  mockSuspendPlatformEndUser,
  mockUnsuspendPlatformEndUser,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockDeletePlatformEndUser: vi.fn(),
  mockGetPlatformCurrentOperator: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockSuspendPlatformEndUser: vi.fn(),
  mockUnsuspendPlatformEndUser: vi.fn(),
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

vi.mock("#lib/users", () => ({
  deletePlatformEndUser: mockDeletePlatformEndUser,
  platformEndUsersCacheTag: "platform:users",
  suspendPlatformEndUser: mockSuspendPlatformEndUser,
  unsuspendPlatformEndUser: mockUnsuspendPlatformEndUser,
}));

vi.mock("#lib/dashboard", () => ({
  platformDashboardCacheTag: "platform:dashboard",
}));

vi.mock("#lib/audit-logs", () => ({
  platformAuditLogsCacheTag: "platform:audit-logs",
}));

const endUserTags = [
  "platform:users",
  "platform:dashboard",
  "platform:audit-logs",
];

const clearedTags = (): string[] =>
  mockUpdateTag.mock.calls.map(([tag]) => tag as string);

describe("end-user detail actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetPlatformLocale.mockResolvedValue("en");
    mockGetPlatformCurrentOperator.mockResolvedValue({
      ok: true,
      operator: {
        name: "Taylor Reed",
        publicId: "OPERATOR001",
        role: "platform_operator",
      },
    });
  });

  it("suspending or unsuspending clears the end users, the dashboard's pending count, and the audit log", async () => {
    const { suspendEndUserAction, unsuspendEndUserAction } =
      await import("./actions");

    await suspendEndUserAction("USER00000001");
    await unsuspendEndUserAction("USER00000001");

    expect(clearedTags()).toEqual([...endUserTags, ...endUserTags]);
  });

  it("deleting an end user clears the same reads before returning to the list", async () => {
    mockDeletePlatformEndUser.mockResolvedValueOnce({ ok: true });

    const { deleteEndUserAction } = await import("./actions");

    await expect(deleteEndUserAction("USER00000001")).rejects.toThrow(
      "NEXT_REDIRECT:/users"
    );
    expect(clearedTags()).toEqual(endUserTags);
  });

  it("clears nothing when the operator may not manage end users", async () => {
    mockGetPlatformCurrentOperator.mockResolvedValue({
      ok: true,
      operator: {
        name: "Morgan Diaz",
        publicId: "OPERATOR003",
        role: "platform_auditor",
      },
    });

    const { suspendEndUserAction } = await import("./actions");

    await suspendEndUserAction("USER00000001");

    expect(mockSuspendPlatformEndUser).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
