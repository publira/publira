import { BadRequestSchema } from "@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb";
import { Code, ConnectError } from "@publira/api-client/errors";
import type { PlatformApiClient } from "@publira/api-client/platform/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addPlatformTenantMember,
  cancelPlatformTenantAdminInvitation,
  createPlatformTenantAdminInvitation,
  createPlatformTenant,
  getPlatformTenant,
  listPlatformTenantAdminInvitations,
  listPlatformTenantMembers,
  listPlatformTenants,
  resendPlatformTenantAdminInvitation,
  resumePlatformTenant,
  suspendPlatformTenant,
} from "./tenants";

type ListTenantsMethod = PlatformApiClient["tenants"]["listTenants"];
type ListTenantsResponse = Awaited<ReturnType<ListTenantsMethod>>;
type ListTenantsResponseTenant = ListTenantsResponse["tenants"][number];

const createListTenantsResponse = ({
  nextToken = "",
  previousToken = "",
  tenants = [],
}: {
  nextToken?: string;
  previousToken?: string;
  tenants?: (Omit<ListTenantsResponseTenant, "$typeName" | "timezone"> & {
    timezone?: string;
  })[];
}): ListTenantsResponse => ({
  $typeName: "publira.platform.v1.ListTenantsResponse",
  nextToken,
  previousToken,
  tenants: tenants.map(({ timezone = "", ...tenant }) => ({
    $typeName: "publira.platform.v1.Tenant",
    timezone,
    ...tenant,
  })),
});

const {
  mockAddTenantMember,
  mockBuildSessionHeaders,
  mockCreateTenant,
  mockCreateTenantAdminInvitation,
  mockGetTenant,
  mockListTenantAdminInvitations,
  mockListTenantMembers,
  mockListTenants,
  mockListOperators,
  mockListUsers,
  mockRemoveTenantMember,
  mockResolveSessionId,
  mockResumeTenant,
  mockResendTenantAdminInvitation,
  mockSuspendTenant,
  mockUpdateTenantMemberRole,
  mockCancelTenantAdminInvitation,
} = vi.hoisted(() => ({
  mockAddTenantMember: vi.fn(),
  mockBuildSessionHeaders: vi.fn(),
  mockCancelTenantAdminInvitation: vi.fn(),
  mockCreateTenant: vi.fn(),
  mockCreateTenantAdminInvitation: vi.fn(),
  mockGetTenant: vi.fn(),
  mockListOperators: vi.fn(),
  mockListTenantAdminInvitations: vi.fn(),
  mockListTenantMembers: vi.fn(),
  mockListTenants: vi.fn<ListTenantsMethod>(),
  mockListUsers: vi.fn(),
  mockRemoveTenantMember: vi.fn(),
  mockResendTenantAdminInvitation: vi.fn(),
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
      cancelTenantAdminInvitation: mockCancelTenantAdminInvitation,
      createTenant: mockCreateTenant,
      createTenantAdminInvitation: mockCreateTenantAdminInvitation,
      getTenant: mockGetTenant,
      listTenantAdminInvitations: mockListTenantAdminInvitations,
      listTenantMembers: mockListTenantMembers,
      listTenants: mockListTenants,
      removeTenantMember: mockRemoveTenantMember,
      resendTenantAdminInvitation: mockResendTenantAdminInvitation,
      resumeTenant: mockResumeTenant,
      suspendTenant: mockSuspendTenant,
      updateTenantMemberRole: mockUpdateTenantMemberRole,
    },
    users: {
      listEndUsers: mockListUsers,
    },
  },
  buildSessionHeaders: mockBuildSessionHeaders,
  resolveAccessToken: mockResolveSessionId,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionId.mockResolvedValue("sess_abc");
  mockBuildSessionHeaders.mockImplementation((sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }));
});

describe("listPlatformTenants", () => {
  it("正常系: テナント一覧を返す", async () => {
    mockListTenants.mockResolvedValueOnce(
      createListTenantsResponse({
        nextToken: "next-page",
        previousToken: "",
        tenants: [
          {
            adminDomain: "admin.example.com",
            createdAt: "2026-03-01 10:00",
            domain: "example.com",
            name: "テスト出版",
            publicId: "tenant_test",
            status: "active",
          },
        ],
      })
    );

    await expect(listPlatformTenants({})).resolves.toEqual({
      nextToken: "next-page",
      ok: true,
      previousToken: "",
      tenants: [
        {
          adminDomain: "admin.example.com",
          createdAt: "2026-03-01 10:00",
          domain: "example.com",
          name: "テスト出版",
          publicId: "tenant_test",
          status: "active",
        },
      ],
    });

    expect(mockListTenants).toHaveBeenCalledWith(
      { limit: 20, name: "", publicId: "", status: "", token: "" },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("ページング引数とフィルターを API に渡す", async () => {
    mockListTenants.mockResolvedValueOnce(
      createListTenantsResponse({
        nextToken: "",
        previousToken: "previous-page",
        tenants: [],
      })
    );

    await expect(
      listPlatformTenants({
        limit: 50,
        name: "テスト",
        status: "active",
        token: "current-page",
      })
    ).resolves.toEqual({
      nextToken: "",
      ok: true,
      previousToken: "previous-page",
      tenants: [],
    });

    expect(mockListTenants).toHaveBeenCalledWith(
      {
        limit: 50,
        name: "テスト",
        publicId: "",
        status: "active",
        token: "current-page",
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("sessionId を解決できない場合は API を呼ばずエラーを返す", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(listPlatformTenants({})).resolves.toEqual({
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
      tenants: [],
    });

    expect(mockListTenants).not.toHaveBeenCalled();
  });

  it("到達不能エラーは共通文言で返す", async () => {
    mockListTenants.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(listPlatformTenants({})).resolves.toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: false,
      tenants: [],
    });
  });

  it("分類できない RPC エラーは伝播する", async () => {
    mockListTenants.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(listPlatformTenants({})).rejects.toThrow("boom");
  });
});

describe("createPlatformTenant", () => {
  it("正常系: payload と Authorization ヘッダーを付与して API を呼ぶ", async () => {
    mockCreateTenant.mockResolvedValueOnce({
      tenant: { publicId: "TENANT000001" },
    });

    await expect(
      createPlatformTenant({
        domain: "example.com",
        initialAdminEmails: ["owner@example.com", ""],
        name: "新規テナント",
      })
    ).resolves.toEqual({ ok: true, publicId: "TENANT000001" });

    expect(mockCreateTenant).toHaveBeenCalledWith(
      {
        adminDomain: "",
        domain: "example.com",
        initialAdminEmails: ["owner@example.com"],
        name: "新規テナント",
      },
      {
        headers: {
          Authorization: "Bearer sess_abc",
        },
      }
    );
  });

  it("sessionId を解決できない場合は API を呼ばず失敗を返す", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(
      createPlatformTenant({
        domain: "example.com",
        name: "n",
      })
    ).resolves.toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    });

    expect(mockCreateTenant).not.toHaveBeenCalled();
  });

  it("details の無いドメイン重複は汎用メッセージにする", async () => {
    mockCreateTenant.mockRejectedValueOnce(
      new ConnectError("domain already exists", Code.AlreadyExists)
    );

    await expect(
      createPlatformTenant({
        domain: "example.com",
        name: "n",
      })
    ).resolves.toEqual({
      message: "重複するデータがあるため作成できません。",
      ok: false,
    });
  });

  it("details の無い管理画面ドメイン重複も汎用メッセージにする", async () => {
    mockCreateTenant.mockRejectedValueOnce(
      new ConnectError("admin_domain already exists", Code.AlreadyExists)
    );

    await expect(
      createPlatformTenant({
        domain: "example.com",
        name: "n",
      })
    ).resolves.toEqual({
      message: "重複するデータがあるため作成できません。",
      ok: false,
    });
  });

  it("domain の field violation を公開ドメイン重複として表示する", async () => {
    mockCreateTenant.mockRejectedValueOnce(
      new ConnectError("duplicate key", Code.AlreadyExists, undefined, [
        {
          desc: BadRequestSchema,
          value: { fieldViolations: [{ field: "domain" }] },
        },
      ])
    );

    await expect(
      createPlatformTenant({
        domain: "example.com",
        name: "n",
      })
    ).resolves.toEqual({
      message: "ドメインが既に使用されています。",
      ok: false,
    });
  });

  it("admin_domain の field violation を管理画面ドメイン重複として表示する", async () => {
    mockCreateTenant.mockRejectedValueOnce(
      new ConnectError("duplicate key", Code.AlreadyExists, undefined, [
        {
          desc: BadRequestSchema,
          value: { fieldViolations: [{ field: "admin_domain" }] },
        },
      ])
    );

    await expect(
      createPlatformTenant({
        domain: "example.com",
        name: "n",
      })
    ).resolves.toEqual({
      message: "管理画面ドメインが既に使用されています。",
      ok: false,
    });
  });

  it("どちらのドメインも名指ししない重複は汎用文言にする", async () => {
    mockCreateTenant.mockRejectedValueOnce(
      new ConnectError("duplicate key", Code.AlreadyExists)
    );

    await expect(
      createPlatformTenant({
        domain: "example.com",
        name: "n",
      })
    ).resolves.toEqual({
      message: "重複するデータがあるため作成できません。",
      ok: false,
    });
  });

  it("入力エラーを入力内容エラーに変換する", async () => {
    mockCreateTenant.mockRejectedValueOnce(
      new ConnectError("invalid initial_admin_emails", Code.InvalidArgument)
    );

    await expect(
      createPlatformTenant({
        domain: "example.com",
        name: "n",
      })
    ).resolves.toEqual({
      message: "入力内容に誤りがあります。",
      ok: false,
    });
  });

  it("テナント詳細を取得して整形する", async () => {
    mockGetTenant.mockResolvedValueOnce({
      tenant: {
        adminDomain: "admin.example.com",
        createdAt: "2026-03-01T10:00:00Z",
        domain: "example.com",
        name: "青楓出版",
        publicId: "tenant_seifuu",
        status: "active",
      },
    });

    await expect(getPlatformTenant("tenant_seifuu")).resolves.toEqual({
      ok: true,
      tenant: {
        adminDomain: "admin.example.com",
        createdAt: "2026-03-01T10:00:00Z",
        domain: "example.com",
        name: "青楓出版",
        publicId: "tenant_seifuu",
        status: "active",
      },
    });

    expect(mockGetTenant).toHaveBeenCalledWith(
      { publicId: "tenant_seifuu" },
      { headers: { Authorization: "Bearer sess_abc" } }
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

    expect(mockListTenantMembers).toHaveBeenCalledWith(
      { tenantPublicId: "tenant_seifuu" },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("停止/再開 API を呼び分ける", async () => {
    mockSuspendTenant.mockResolvedValueOnce({});
    mockResumeTenant.mockResolvedValueOnce({});

    await expect(suspendPlatformTenant("tenant_seifuu")).resolves.toBe(true);
    await expect(resumePlatformTenant("tenant_seifuu")).resolves.toBe(true);

    expect(mockSuspendTenant).toHaveBeenCalledWith(
      { publicId: "tenant_seifuu" },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
    expect(mockResumeTenant).toHaveBeenCalledWith(
      { publicId: "tenant_seifuu" },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("メンバー追加時はエンドユーザーをメール検索して userPublicId に解決する", async () => {
    mockAddTenantMember.mockResolvedValueOnce({});

    await expect(
      addPlatformTenantMember({
        email: "member@example.com",
        role: "tenant_admin",
        tenantId: "tenant_seifuu",
      })
    ).resolves.toEqual({ ok: true });

    expect(mockAddTenantMember).toHaveBeenCalledWith(
      {
        email: "member@example.com",
        role: "tenant_admin",
        tenantId: "tenant_seifuu",
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("メンバー追加時はメールを小文字正規化して送信する", async () => {
    mockAddTenantMember.mockResolvedValueOnce({});

    await expect(
      addPlatformTenantMember({
        email: "Member@Example.COM",
        role: "tenant_admin",
        tenantId: "tenant_seifuu",
      })
    ).resolves.toEqual({ ok: true });

    expect(mockAddTenantMember).toHaveBeenCalledWith(
      {
        email: "member@example.com",
        role: "tenant_admin",
        tenantId: "tenant_seifuu",
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("対象テナントに該当ユーザーがいない場合は見つからないエラーを返す", async () => {
    mockAddTenantMember.mockRejectedValueOnce(
      new ConnectError("member not found", Code.NotFound)
    );

    await expect(
      addPlatformTenantMember({
        email: "member@example.com",
        role: "tenant_admin",
        tenantId: "tenant_seifuu",
      })
    ).resolves.toEqual({
      message: "指定したメールアドレスのユーザーが見つかりません。",
      ok: false,
    });
  });
});

describe("tenant admin invitations", () => {
  it("招待一覧を取得する", async () => {
    mockListTenantAdminInvitations.mockResolvedValueOnce({
      invitations: [
        {
          acceptedAt: "",
          canceledAt: "",
          createdAt: "2026-03-30T00:00:00Z",
          email: "admin@example.com",
          expiresAt: "2026-03-31T00:00:00Z",
          id: "inv_001",
          status: "pending",
        },
      ],
      nextToken: "next-page",
      previousToken: "",
    });

    await expect(
      listPlatformTenantAdminInvitations({ tenantId: "tenant_seifuu" })
    ).resolves.toEqual({
      invitations: [
        {
          acceptedAt: "",
          canceledAt: "",
          createdAt: "2026-03-30T00:00:00Z",
          email: "admin@example.com",
          expiresAt: "2026-03-31T00:00:00Z",
          id: "inv_001",
          status: "pending",
        },
      ],
      nextToken: "next-page",
      ok: true,
      previousToken: "",
    });

    expect(mockListTenantAdminInvitations).toHaveBeenCalledWith(
      {
        limit: 20,
        tenantPublicId: "tenant_seifuu",
        token: "",
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("ページング引数を API に渡す", async () => {
    mockListTenantAdminInvitations.mockResolvedValueOnce({
      invitations: [],
      nextToken: "",
      previousToken: "previous-page",
    });

    await expect(
      listPlatformTenantAdminInvitations({
        limit: 50,
        tenantId: "tenant_seifuu",
        token: "current-page",
      })
    ).resolves.toEqual({
      invitations: [],
      nextToken: "",
      ok: true,
      previousToken: "previous-page",
    });

    expect(mockListTenantAdminInvitations).toHaveBeenCalledWith(
      {
        limit: 50,
        tenantPublicId: "tenant_seifuu",
        token: "current-page",
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("sessionId を解決できない場合は API を呼ばずエラーを返す", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(
      listPlatformTenantAdminInvitations({ tenantId: "tenant_seifuu" })
    ).resolves.toEqual({
      invitations: [],
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    });

    expect(mockListTenantAdminInvitations).not.toHaveBeenCalled();
  });

  it("到達不能エラーは共通文言で返す", async () => {
    mockListTenantAdminInvitations.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(
      listPlatformTenantAdminInvitations({ tenantId: "tenant_seifuu" })
    ).resolves.toEqual({
      invitations: [],
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
  });

  it("分類できない RPC エラーは伝播する", async () => {
    mockListTenantAdminInvitations.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      listPlatformTenantAdminInvitations({ tenantId: "tenant_seifuu" })
    ).rejects.toThrow("boom");
  });

  it("招待作成が成功する", async () => {
    mockCreateTenantAdminInvitation.mockResolvedValueOnce({
      invitation: {
        acceptedAt: "",
        canceledAt: "",
        createdAt: "2026-03-30T00:00:00Z",
        email: "admin@example.com",
        expiresAt: "2026-03-31T00:00:00Z",
        id: "inv_001",
        status: "pending",
      },
      roleGrantedImmediately: false,
    });

    await expect(
      createPlatformTenantAdminInvitation("tenant_seifuu", "admin@example.com")
    ).resolves.toEqual({
      invitation: {
        acceptedAt: "",
        canceledAt: "",
        createdAt: "2026-03-30T00:00:00Z",
        email: "admin@example.com",
        expiresAt: "2026-03-31T00:00:00Z",
        id: "inv_001",
        status: "pending",
      },
      ok: true,
      roleGrantedImmediately: false,
    });
  });

  it("招待再送が成功する", async () => {
    mockResendTenantAdminInvitation.mockResolvedValueOnce({
      invitation: {
        acceptedAt: "",
        canceledAt: "",
        createdAt: "2026-03-30T00:00:00Z",
        email: "admin@example.com",
        expiresAt: "2026-03-31T00:00:00Z",
        id: "inv_001",
        status: "pending",
      },
    });

    await expect(
      resendPlatformTenantAdminInvitation("tenant_seifuu", "inv_001")
    ).resolves.toEqual({
      invitation: {
        acceptedAt: "",
        canceledAt: "",
        createdAt: "2026-03-30T00:00:00Z",
        email: "admin@example.com",
        expiresAt: "2026-03-31T00:00:00Z",
        id: "inv_001",
        status: "pending",
      },
      ok: true,
    });
  });

  it("招待取り消しが成功する", async () => {
    mockCancelTenantAdminInvitation.mockResolvedValueOnce({
      invitation: {
        acceptedAt: "",
        canceledAt: "2026-03-30T01:00:00Z",
        createdAt: "2026-03-30T00:00:00Z",
        email: "admin@example.com",
        expiresAt: "2026-03-31T00:00:00Z",
        id: "inv_001",
        status: "canceled",
      },
    });

    await expect(
      cancelPlatformTenantAdminInvitation("tenant_seifuu", "inv_001")
    ).resolves.toEqual({
      invitation: {
        acceptedAt: "",
        canceledAt: "2026-03-30T01:00:00Z",
        createdAt: "2026-03-30T00:00:00Z",
        email: "admin@example.com",
        expiresAt: "2026-03-31T00:00:00Z",
        id: "inv_001",
        status: "canceled",
      },
      ok: true,
    });
  });
});
