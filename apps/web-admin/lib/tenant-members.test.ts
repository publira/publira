import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockCancelInvitation,
  mockCreateInvitation,
  mockGetAccessToken,
  mockListInvitations,
  mockListMembers,
  mockRemoveMember,
  mockResendInvitation,
  mockUpdateRole,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockCancelInvitation: vi.fn(),
  mockCreateInvitation: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockListInvitations: vi.fn(),
  mockListMembers: vi.fn(),
  mockRemoveMember: vi.fn(),
  mockResendInvitation: vi.fn(),
  mockUpdateRole: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    members: {
      cancelTenantAdminInvitation: mockCancelInvitation,
      createTenantAdminInvitation: mockCreateInvitation,
      listTenantAdminInvitations: mockListInvitations,
      listTenantMembers: mockListMembers,
      removeTenantMember: mockRemoveMember,
      resendTenantAdminInvitation: mockResendInvitation,
      updateTenantMemberRole: mockUpdateRole,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const reasonError = (code: Code, reason: string) =>
  new ConnectError("refused", code, undefined, [
    { desc: ErrorInfoSchema, value: { domain: "publira", reason } },
  ]);

const lastAdminError = () =>
  reasonError(Code.FailedPrecondition, "LAST_TENANT_ADMIN");

const lastAdminDemoteByLocale: Record<Locale, string> = {
  en: "This member is the tenant's last tenant admin. Make someone else a tenant admin before changing this role.",
  ja: "このメンバーはテナント最後のテナント管理者です。ほかの人をテナント管理者にしてからロールを変更してください。",
  ko: "이 멤버는 테넌트의 마지막 테넌트 관리자입니다. 다른 사람을 테넌트 관리자로 지정한 뒤 역할을 변경하세요.",
  "zh-Hans":
    "此成员是该租户最后一位租户管理员。请先将其他人设为租户管理员，再变更此角色。",
  "zh-Hant":
    "此成員是該租戶最後一位租戶管理員。請先將其他人設為租戶管理員，再變更此角色。",
};

const lastAdminRemoveByLocale: Record<Locale, string> = {
  en: "This member is the tenant's last tenant admin. Make someone else a tenant admin before removing them.",
  ja: "このメンバーはテナント最後のテナント管理者です。ほかの人をテナント管理者にしてから削除してください。",
  ko: "이 멤버는 테넌트의 마지막 테넌트 관리자입니다. 다른 사람을 테넌트 관리자로 지정한 뒤 삭제하세요.",
  "zh-Hans":
    "此成员是该租户最后一位租户管理员。请先将其他人设为租户管理员，再移除此成员。",
  "zh-Hant":
    "此成員是該租戶最後一位租戶管理員。請先將其他人設為租戶管理員，再移除此成員。",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("listTenantMembers", () => {
  it("maps one page and files it under the member tag", async () => {
    mockListMembers.mockResolvedValueOnce({
      members: [
        {
          createdAt: "2026-09-01T00:00:00Z",
          email: "admin@example.com",
          name: "Avery Admin",
          role: "tenant_admin",
          status: "active",
          userPublicId: "USER001",
        },
      ],
      nextToken: "next",
      previousToken: "",
    });
    const { listTenantMembers } = await import("./tenant-members");

    const result = await listTenantMembers("TENANT001", "en", {
      token: "current",
    });

    expect(result).toEqual({
      members: [
        {
          createdAt: "2026-09-01T00:00:00Z",
          email: "admin@example.com",
          name: "Avery Admin",
          role: "tenant_admin",
          status: "active",
          userPublicId: "USER001",
        },
      ],
      nextToken: "next",
      ok: true,
      previousToken: "",
    });
    expect(mockListMembers).toHaveBeenCalledWith(
      { limit: 20, tenant: { tenantId: "TENANT001" }, token: "current" },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("tenant-members-TENANT001");
  });

  it("asks for a sign-in when the API rejects the session", async () => {
    mockListMembers.mockRejectedValueOnce(
      new ConnectError("no session", Code.Unauthenticated)
    );
    const { listTenantMembers } = await import("./tenant-members");

    const result = await listTenantMembers("TENANT001", "en");

    expect(result).toMatchObject({
      members: [],
      ok: false,
      requiresSignIn: true,
    });
  });
});

describe("listTenantAdminInvitations", () => {
  it("maps one page and files it under the invitation tag", async () => {
    mockListInvitations.mockResolvedValueOnce({
      invitations: [
        {
          acceptedAt: "",
          canceledAt: "",
          createdAt: "2026-09-01T00:00:00Z",
          email: "invitee@example.com",
          expiresAt: "2026-09-02T00:00:00Z",
          id: "INV1",
          status: "pending",
        },
      ],
      nextToken: "",
      previousToken: "prev",
    });
    const { listTenantAdminInvitations } = await import("./tenant-members");

    const result = await listTenantAdminInvitations("TENANT001", "en");

    expect(result).toEqual({
      invitations: [
        {
          createdAt: "2026-09-01T00:00:00Z",
          email: "invitee@example.com",
          expiresAt: "2026-09-02T00:00:00Z",
          id: "INV1",
          status: "pending",
        },
      ],
      nextToken: "",
      ok: true,
      previousToken: "prev",
    });
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant-admin-invitations-TENANT001"
    );
  });
});

describe("updateTenantMemberRole", () => {
  it.each(getLocales())(
    "words the last-admin refusal in %s",
    async (locale) => {
      mockUpdateRole.mockRejectedValueOnce(lastAdminError());
      const { updateTenantMemberRole } = await import("./tenant-members");

      const result = await updateTenantMemberRole(
        { role: "tenant_editor", tenantId: "TENANT001", userPublicId: "U1" },
        locale
      );

      expect(result).toEqual({
        message: lastAdminDemoteByLocale[locale],
        ok: false,
      });
    }
  );

  it("keeps the operation's own wording for another failed precondition", async () => {
    mockUpdateRole.mockRejectedValueOnce(
      new ConnectError("refused", Code.FailedPrecondition)
    );
    const { updateTenantMemberRole } = await import("./tenant-members");

    const result = await updateTenantMemberRole(
      { role: "tenant_editor", tenantId: "TENANT001", userPublicId: "U1" },
      "en"
    );

    expect(result).toEqual({
      message: "Could not change the role. Please try again later.",
      ok: false,
    });
  });
});

describe("removeTenantMember", () => {
  it.each(getLocales())(
    "words the last-admin refusal in %s",
    async (locale) => {
      mockRemoveMember.mockRejectedValueOnce(lastAdminError());
      const { removeTenantMember } = await import("./tenant-members");

      const result = await removeTenantMember(
        { tenantId: "TENANT001", userPublicId: "U1" },
        locale
      );

      expect(result).toEqual({
        message: lastAdminRemoveByLocale[locale],
        ok: false,
      });
    }
  );

  it("says the member is gone when the API cannot find them", async () => {
    mockRemoveMember.mockRejectedValueOnce(
      new ConnectError("missing", Code.NotFound)
    );
    const { removeTenantMember } = await import("./tenant-members");

    const result = await removeTenantMember(
      { tenantId: "TENANT001", userPublicId: "U1" },
      "en"
    );

    expect(result).toEqual({
      message: "This member could not be found. Reload the member list.",
      ok: false,
    });
  });
});

describe("createTenantAdminInvitation", () => {
  it.each([true, false])(
    "reports whether the role was granted on the spot (%s)",
    async (roleGrantedImmediately) => {
      mockCreateInvitation.mockResolvedValueOnce({ roleGrantedImmediately });
      const { createTenantAdminInvitation } = await import("./tenant-members");

      const result = await createTenantAdminInvitation(
        { email: "invitee@example.com", tenantId: "TENANT001" },
        "en"
      );

      expect(result).toEqual({ ok: true, roleGrantedImmediately });
    }
  );

  it("words an address the API refuses", async () => {
    mockCreateInvitation.mockRejectedValueOnce(
      new ConnectError("invalid email", Code.InvalidArgument)
    );
    const { createTenantAdminInvitation } = await import("./tenant-members");

    const result = await createTenantAdminInvitation(
      { email: "invitee@example", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      message: "Check the email address format.",
      ok: false,
    });
  });
});

describe("invitation writes", () => {
  it("says an invitation was already canceled", async () => {
    mockResendInvitation.mockRejectedValueOnce(
      reasonError(Code.FailedPrecondition, "INVITATION_CANCELED")
    );
    const { resendTenantAdminInvitation } = await import("./tenant-members");

    const result = await resendTenantAdminInvitation(
      { invitationId: "INV1", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      message: "This invitation has already been canceled.",
      ok: false,
    });
  });

  it("refuses to cancel an accepted invitation in the operation's words", async () => {
    mockCancelInvitation.mockRejectedValueOnce(
      new ConnectError("accepted", Code.FailedPrecondition)
    );
    const { cancelTenantAdminInvitation } = await import("./tenant-members");

    const result = await cancelTenantAdminInvitation(
      { invitationId: "INV1", tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({
      message: "This invitation can no longer be canceled.",
      ok: false,
    });
  });
});
