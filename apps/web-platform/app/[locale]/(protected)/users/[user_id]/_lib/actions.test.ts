import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as LocaleModule from "#lib/locale";

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
  mockUpdateTag.mock.calls.map(([tag]) => tag);

const endUserId = "0199a3c0-0000-7000-8000-00000000000a";

const userForm = (userId: string): FormData => {
  const formData = new FormData();
  formData.set("user_id", userId);

  return formData;
};

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
    mockSuspendPlatformEndUser.mockResolvedValueOnce({ ok: true });
    mockUnsuspendPlatformEndUser.mockResolvedValueOnce({ ok: true });

    const { suspendEndUserAction, unsuspendEndUserAction } =
      await import("./actions");

    await expect(
      suspendEndUserAction(null, userForm(endUserId))
    ).resolves.toEqual({ message: "", ok: true });
    await expect(
      unsuspendEndUserAction(null, userForm(endUserId))
    ).resolves.toEqual({ message: "", ok: true });

    expect(mockSuspendPlatformEndUser).toHaveBeenCalledWith(endUserId, "en");
    expect(mockUnsuspendPlatformEndUser).toHaveBeenCalledWith(endUserId, "en");
    expect(clearedTags()).toEqual([...endUserTags, ...endUserTags]);
  });

  it("deleting an end user clears the same reads before returning to the list", async () => {
    mockDeletePlatformEndUser.mockResolvedValueOnce({ ok: true });

    const { deleteEndUserAction } = await import("./actions");

    await expect(
      deleteEndUserAction(null, userForm(endUserId))
    ).rejects.toThrow("NEXT_REDIRECT:/users");
    expect(clearedTags()).toEqual(endUserTags);
  });

  it.each([
    ["suspendEndUserAction", mockSuspendPlatformEndUser],
    ["unsuspendEndUserAction", mockUnsuspendPlatformEndUser],
    ["deleteEndUserAction", mockDeletePlatformEndUser],
  ] as const)(
    "%s answers with the refusal the API met, clears nothing, and stays on the page",
    async (name, mockChange) => {
      mockChange.mockResolvedValueOnce({
        message: "The requested item could not be found.",
        ok: false,
      });

      const actions = await import("./actions");

      await expect(actions[name](null, userForm(endUserId))).resolves.toEqual({
        message: "The requested item could not be found.",
        ok: false,
      });
      expect(mockUpdateTag).not.toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    }
  );

  it("says an operator who may not manage end users may not suspend one", async () => {
    mockGetPlatformCurrentOperator.mockResolvedValue({
      ok: true,
      operator: {
        name: "Morgan Diaz",
        publicId: "OPERATOR003",
        role: "platform_auditor",
      },
    });

    const { suspendEndUserAction } = await import("./actions");

    await expect(
      suspendEndUserAction(null, userForm(endUserId))
    ).resolves.toEqual({
      message:
        "You do not have permission to perform this action. Go back or use an account that does.",
      ok: false,
    });
    expect(mockSuspendPlatformEndUser).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("sends no request for a user ID that is not a UUID", async () => {
    const { suspendEndUserAction } = await import("./actions");

    const result = await suspendEndUserAction(null, userForm("SeedUSERAAA1"));

    expect(result?.ok).toBe(false);
    expect(mockSuspendPlatformEndUser).not.toHaveBeenCalled();
  });
});
