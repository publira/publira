import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addPlatformTenantMember,
  createPlatformTenant,
  getPlatformTenant,
  listPlatformTenantMembers,
  listPlatformTenants,
  resumePlatformTenant,
  suspendPlatformTenant,
} from "./tenants";

const {
  mockAddTenantMember,
  mockBuildSessionHeaders,
  mockCreateTenant,
  mockGetTenant,
  mockListTenantMembers,
  mockListTenants,
  mockListOperators,
  mockListUsers,
  mockRemoveTenantMember,
  mockResolveSessionId,
  mockResumeTenant,
  mockSuspendTenant,
  mockUpdateTenantMemberRole,
} = vi.hoisted(() => ({
  mockAddTenantMember: vi.fn(),
  mockBuildSessionHeaders: vi.fn(),
  mockCreateTenant: vi.fn(),
  mockGetTenant: vi.fn(),
  mockListOperators: vi.fn(),
  mockListTenantMembers: vi.fn(),
  mockListTenants: vi.fn(),
  mockListUsers: vi.fn(),
  mockRemoveTenantMember: vi.fn(),
  mockResolveSessionId: vi.fn(),
  mockResumeTenant: vi.fn(),
  mockSuspendTenant: vi.fn(),
  mockUpdateTenantMemberRole: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    operators: {
      listOperators: mockListOperators,
    },
    tenants: {
      addTenantMember: mockAddTenantMember,
      createTenant: mockCreateTenant,
      getTenant: mockGetTenant,
      listTenantMembers: mockListTenantMembers,
      listTenants: mockListTenants,
      removeTenantMember: mockRemoveTenantMember,
      resumeTenant: mockResumeTenant,
      suspendTenant: mockSuspendTenant,
      updateTenantMemberRole: mockUpdateTenantMemberRole,
    },
    users: {
      listEndUsers: mockListUsers,
    },
  },
  buildSessionHeaders: mockBuildSessionHeaders,
  resolveSessionId: mockResolveSessionId,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionId.mockResolvedValue("sess_abc");
  mockBuildSessionHeaders.mockImplementation((sessionId: string) => ({
    headers: { "X-Publira-Session-Id": sessionId },
  }));
});

describe("listPlatformTenants", () => {
  it("正常系: テナント一覧を返す", async () => {
    mockListTenants.mockResolvedValueOnce({
      tenants: [
        {
          createdAt: "2026-03-01 10:00",
          domain: "example.com",
          name: "テスト出版",
          publicId: "tenant_test",
          status: "active",
          subdomain: "test-pub",
        },
      ],
    });

    await expect(listPlatformTenants({})).resolves.toEqual({
      ok: true,
      tenants: [
        {
          createdAt: "2026-03-01 10:00",
          domain: "example.com",
          name: "テスト出版",
          publicId: "tenant_test",
          status: "active",
          subdomain: "test-pub",
        },
      ],
    });

    expect(mockListTenants).toHaveBeenCalledWith(
      { name: "", status: "" },
      { headers: { "X-Publira-Session-Id": "sess_abc" } }
    );
  });

  it("name / status フィルターを API に渡す", async () => {
    mockListTenants.mockResolvedValueOnce({ tenants: [] });

    await expect(
      listPlatformTenants({
        name: "テスト",
        status: "active",
      })
    ).resolves.toEqual({ ok: true, tenants: [] });

    expect(mockListTenants).toHaveBeenCalledWith(
      { name: "テスト", status: "active" },
      { headers: { "X-Publira-Session-Id": "sess_abc" } }
    );
  });

  it("sessionId を解決できない場合は API を呼ばずエラーを返す", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(listPlatformTenants({})).resolves.toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    });

    expect(mockListTenants).not.toHaveBeenCalled();
  });

  it("API がエラーを返した場合はエラーメッセージを返す", async () => {
    mockListTenants.mockRejectedValueOnce(new Error("network error"));

    await expect(listPlatformTenants({})).resolves.toEqual({
      message: "network error",
      ok: false,
    });
  });
});

describe("createPlatformTenant", () => {
  it("正常系: payload と X-Publira-Session-Id ヘッダーを付与して API を呼ぶ", async () => {
    mockCreateTenant.mockResolvedValueOnce({
      tenant: { publicId: "TENANT000001" },
    });

    await expect(
      createPlatformTenant({
        domain: "example.com",
        initialAdminEmails: ["owner@example.com", ""],
        name: "新規テナント",
        subdomain: "tenant-1",
      })
    ).resolves.toEqual({ ok: true, publicId: "TENANT000001" });

    expect(mockCreateTenant).toHaveBeenCalledWith(
      {
        domain: "example.com",
        initialAdminEmails: ["owner@example.com"],
        name: "新規テナント",
        subdomain: "tenant-1",
      },
      {
        headers: {
          "X-Publira-Session-Id": "sess_abc",
        },
      }
    );
  });

  it("sessionId を解決できない場合は API を呼ばず失敗を返す", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(
      createPlatformTenant({
        name: "n",
        subdomain: "s",
      })
    ).resolves.toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    });

    expect(mockCreateTenant).not.toHaveBeenCalled();
  });

  it("サブドメイン重複エラーを専用メッセージに変換する", async () => {
    mockCreateTenant.mockRejectedValueOnce(
      new Error("already_exists: subdomain already exists")
    );

    await expect(
      createPlatformTenant({
        name: "n",
        subdomain: "s",
      })
    ).resolves.toEqual({
      message: "サブドメインが既に使用されています。",
      ok: false,
    });
  });

  it("入力エラーを入力内容エラーに変換する", async () => {
    mockCreateTenant.mockRejectedValueOnce(
      new Error("invalid_argument: invalid initial_admin_emails")
    );

    await expect(
      createPlatformTenant({
        name: "n",
        subdomain: "s",
      })
    ).resolves.toEqual({
      message: "入力内容に誤りがあります。",
      ok: false,
    });
  });

  it("テナント詳細を取得して整形する", async () => {
    mockGetTenant.mockResolvedValueOnce({
      tenant: {
        createdAt: "2026-03-01T10:00:00Z",
        domain: "example.com",
        name: "青楓出版",
        publicId: "tenant_seifuu",
        status: "active",
        subdomain: "seifuu",
      },
    });

    await expect(getPlatformTenant("tenant_seifuu")).resolves.toEqual({
      createdAt: "2026-03-01T10:00:00Z",
      domain: "example.com",
      name: "青楓出版",
      publicId: "tenant_seifuu",
      status: "active",
      subdomain: "seifuu",
    });

    expect(mockGetTenant).toHaveBeenCalledWith(
      { publicId: "tenant_seifuu" },
      { headers: { "X-Publira-Session-Id": "sess_abc" } }
    );
  });

  it("テナントメンバー一覧を取得する", async () => {
    mockListTenantMembers.mockResolvedValueOnce({
      members: [
        {
          createdAt: "2026-03-02T00:00:00Z",
          email: "owner@example.com",
          name: "Owner",
          role: "tenant_owner",
          status: "active",
          userPublicId: "user_001",
        },
      ],
    });

    await expect(listPlatformTenantMembers("tenant_seifuu")).resolves.toEqual([
      {
        createdAt: "2026-03-02T00:00:00Z",
        email: "owner@example.com",
        name: "Owner",
        role: "tenant_owner",
        status: "active",
        userPublicId: "user_001",
      },
    ]);
  });

  it("停止/再開 API を呼び分ける", async () => {
    mockSuspendTenant.mockResolvedValueOnce({});
    mockResumeTenant.mockResolvedValueOnce({});

    await expect(suspendPlatformTenant("tenant_seifuu")).resolves.toBe(true);
    await expect(resumePlatformTenant("tenant_seifuu")).resolves.toBe(true);

    expect(mockSuspendTenant).toHaveBeenCalledWith(
      { publicId: "tenant_seifuu" },
      { headers: { "X-Publira-Session-Id": "sess_abc" } }
    );
    expect(mockResumeTenant).toHaveBeenCalledWith(
      { publicId: "tenant_seifuu" },
      { headers: { "X-Publira-Session-Id": "sess_abc" } }
    );
  });

  it("メンバー追加時はエンドユーザーをメール検索して userPublicId に解決する", async () => {
    mockListOperators.mockResolvedValueOnce({ operators: [] });
    mockListUsers.mockResolvedValueOnce({
      users: [
        {
          createdAt: "2026-03-01T00:00:00Z",
          email: "member@example.com",
          name: "Member",
          publicId: "user_member_001",
          status: "active",
          tenantIds: [],
        },
      ],
    });
    mockAddTenantMember.mockResolvedValueOnce({});

    await expect(
      addPlatformTenantMember({
        email: "member@example.com",
        role: "tenant_admin",
        tenantPublicId: "tenant_seifuu",
      })
    ).resolves.toEqual({ ok: true });

    expect(mockAddTenantMember).toHaveBeenCalledWith(
      {
        role: "tenant_admin",
        tenantPublicId: "tenant_seifuu",
        userPublicId: "user_member_001",
      },
      { headers: { "X-Publira-Session-Id": "sess_abc" } }
    );
  });

  it("メンバー追加時はオペレーターもメール検索対象に含める", async () => {
    mockListOperators.mockResolvedValueOnce({
      operators: [
        {
          createdAt: "2026-03-01T00:00:00Z",
          email: "op@example.com",
          name: "Operator",
          publicId: "user_operator_001",
          role: "platform_operator",
          status: "active",
        },
      ],
    });
    mockAddTenantMember.mockResolvedValueOnce({});

    await expect(
      addPlatformTenantMember({
        email: "op@example.com",
        role: "tenant_admin",
        tenantPublicId: "tenant_seifuu",
      })
    ).resolves.toEqual({ ok: true });

    expect(mockAddTenantMember).toHaveBeenCalledWith(
      {
        role: "tenant_admin",
        tenantPublicId: "tenant_seifuu",
        userPublicId: "user_operator_001",
      },
      { headers: { "X-Publira-Session-Id": "sess_abc" } }
    );
    expect(mockListUsers).not.toHaveBeenCalled();
  });
});
