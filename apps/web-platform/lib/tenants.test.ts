import { BadRequestSchema } from "@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb";
import { Code, ConnectError } from "@publira/api-client/errors";
import type { PlatformApiClient } from "@publira/api-client/platform/client";
import type { Tenant } from "@publira/api-client/platform/types";
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

const createListTenantsResponse = ({
  nextToken = "",
  previousToken = "",
  tenants = [],
}: {
  nextToken?: string;
  previousToken?: string;
  tenants?: (Omit<Tenant, "$typeName" | "timezone"> & {
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
  it("returns tenant lists", async () => {
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

    await expect(listPlatformTenants({ locale: "ja" })).resolves.toEqual({
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

  it("passes pagination arguments and filters to the API", async () => {
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
        locale: "ja",
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

  it("returns an error without calling the API when sessionId cannot be resolved", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(listPlatformTenants({ locale: "ja" })).resolves.toEqual({
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
      tenants: [],
    });

    expect(mockListTenants).not.toHaveBeenCalled();
  });

  it("returns an English session error for locale=en", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(listPlatformTenants({ locale: "en" })).resolves.toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
      tenants: [],
    });
  });

  it("returns a shared message for unavailable errors", async () => {
    mockListTenants.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(listPlatformTenants({ locale: "ja" })).resolves.toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: false,
      tenants: [],
    });
  });

  it("propagates unclassified RPC errors", async () => {
    mockListTenants.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(listPlatformTenants({ locale: "ja" })).rejects.toThrow("boom");
  });
});

describe("createPlatformTenant", () => {
  it("calls the API with the payload and Authorization header", async () => {
    mockCreateTenant.mockResolvedValueOnce({
      tenant: { publicId: "TENANT000001" },
    });

    await expect(
      createPlatformTenant({
        defaultLocale: "ja",
        domain: "example.com",
        initialAdminEmails: ["owner@example.com", ""],
        locale: "ja",
        name: "新規テナント",
      })
    ).resolves.toEqual({ ok: true, publicId: "TENANT000001" });

    expect(mockCreateTenant).toHaveBeenCalledWith(
      {
        adminDomain: "",
        defaultLocale: "ja",
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

  it("returns a failure without calling the API when sessionId cannot be resolved", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(
      createPlatformTenant({
        defaultLocale: "ja",
        domain: "example.com",
        locale: "ja",
        name: "n",
      })
    ).resolves.toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    });

    expect(mockCreateTenant).not.toHaveBeenCalled();
  });

  it("uses a generic message for domain conflicts without details", async () => {
    mockCreateTenant.mockRejectedValueOnce(
      new ConnectError("domain already exists", Code.AlreadyExists)
    );

    await expect(
      createPlatformTenant({
        defaultLocale: "ja",
        domain: "example.com",
        locale: "ja",
        name: "n",
      })
    ).resolves.toEqual({
      message: "重複するデータがあるため作成できません。",
      ok: false,
    });
  });

  it("uses a generic message for admin domain conflicts without details", async () => {
    mockCreateTenant.mockRejectedValueOnce(
      new ConnectError("admin_domain already exists", Code.AlreadyExists)
    );

    await expect(
      createPlatformTenant({
        defaultLocale: "ja",
        domain: "example.com",
        locale: "ja",
        name: "n",
      })
    ).resolves.toEqual({
      message: "重複するデータがあるため作成できません。",
      ok: false,
    });
  });

  it("shows a domain field violation as a public domain conflict", async () => {
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
        defaultLocale: "ja",
        domain: "example.com",
        locale: "ja",
        name: "n",
      })
    ).resolves.toEqual({
      message: "ドメインが既に使用されています。",
      ok: false,
    });
  });

  it("returns an English domain conflict message for locale=en", async () => {
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
        defaultLocale: "ja",
        domain: "example.com",
        locale: "en",
        name: "n",
      })
    ).resolves.toEqual({
      message: "This domain is already in use.",
      ok: false,
    });
  });

  it("shows an admin_domain field violation as an admin domain conflict", async () => {
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
        defaultLocale: "ja",
        domain: "example.com",
        locale: "ja",
        name: "n",
      })
    ).resolves.toEqual({
      message: "管理画面ドメインが既に使用されています。",
      ok: false,
    });
  });

  it("uses a generic message for conflicts that name neither domain", async () => {
    mockCreateTenant.mockRejectedValueOnce(
      new ConnectError("duplicate key", Code.AlreadyExists)
    );

    await expect(
      createPlatformTenant({
        defaultLocale: "ja",
        domain: "example.com",
        locale: "ja",
        name: "n",
      })
    ).resolves.toEqual({
      message: "重複するデータがあるため作成できません。",
      ok: false,
    });
  });

  it("converts input errors to validation errors", async () => {
    mockCreateTenant.mockRejectedValueOnce(
      new ConnectError("invalid initial_admin_emails", Code.InvalidArgument)
    );

    await expect(
      createPlatformTenant({
        defaultLocale: "ja",
        domain: "example.com",
        locale: "ja",
        name: "n",
      })
    ).resolves.toEqual({
      message: "入力内容に誤りがあります。",
      ok: false,
    });
  });

  it("fetches and formats tenant details", async () => {
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

    await expect(getPlatformTenant("tenant_seifuu", "ja")).resolves.toEqual({
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

  it("returns tenant: null rather than a failure for a missing tenant", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("tenant not found", Code.NotFound)
    );

    await expect(getPlatformTenant("tenant_missing", "ja")).resolves.toEqual({
      ok: true,
      tenant: null,
    });
  });

  it("distinguishes loading failures from tenant: null", async () => {
    // The page turns `tenant: null` into notFound(); an outage must not take
    // that branch, or an existing tenant reads as deleted.
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(getPlatformTenant("tenant_seifuu", "ja")).resolves.toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
      requiresSignIn: false,
    });
  });

  it("requires reauthentication when loading fails for an expired session", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("invalid token", Code.Unauthenticated)
    );

    await expect(
      getPlatformTenant("tenant_seifuu", "ja")
    ).resolves.toMatchObject({
      ok: false,
      requiresSignIn: true,
    });
  });

  it("fetches tenant members", async () => {
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

    await expect(
      listPlatformTenantMembers({ locale: "ja", tenantId: "tenant_seifuu" })
    ).resolves.toEqual({
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
      nextToken: "",
      ok: true,
      previousToken: "",
    });

    expect(mockListTenantMembers).toHaveBeenCalledWith(
      { limit: 20, tenantPublicId: "tenant_seifuu", token: "" },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("calls the suspend or resume API as appropriate", async () => {
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

  it("resolves an end user by email to userPublicId when adding a member", async () => {
    mockAddTenantMember.mockResolvedValueOnce({});

    await expect(
      addPlatformTenantMember({
        email: "member@example.com",
        locale: "ja",
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

  it("normalizes email to lowercase when adding a member", async () => {
    mockAddTenantMember.mockResolvedValueOnce({});

    await expect(
      addPlatformTenantMember({
        email: "Member@Example.COM",
        locale: "ja",
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

  it("returns a not-found error when the user is not in the tenant", async () => {
    mockAddTenantMember.mockRejectedValueOnce(
      new ConnectError("member not found", Code.NotFound)
    );

    await expect(
      addPlatformTenantMember({
        email: "member@example.com",
        locale: "ja",
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
  it("fetches invitations", async () => {
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
      listPlatformTenantAdminInvitations({
        locale: "ja",
        tenantId: "tenant_seifuu",
      })
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

  it("passes pagination arguments to the API", async () => {
    mockListTenantAdminInvitations.mockResolvedValueOnce({
      invitations: [],
      nextToken: "",
      previousToken: "previous-page",
    });

    await expect(
      listPlatformTenantAdminInvitations({
        limit: 50,
        locale: "ja",
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

  it("returns an error without calling the API when sessionId cannot be resolved", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(
      listPlatformTenantAdminInvitations({
        locale: "ja",
        tenantId: "tenant_seifuu",
      })
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

  it("returns a shared message for unavailable errors", async () => {
    mockListTenantAdminInvitations.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(
      listPlatformTenantAdminInvitations({
        locale: "ja",
        tenantId: "tenant_seifuu",
      })
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

  it("propagates unclassified RPC errors", async () => {
    mockListTenantAdminInvitations.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      listPlatformTenantAdminInvitations({
        locale: "ja",
        tenantId: "tenant_seifuu",
      })
    ).rejects.toThrow("boom");
  });

  it("creates an invitation", async () => {
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
      createPlatformTenantAdminInvitation(
        "tenant_seifuu",
        "admin@example.com",
        "ja"
      )
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

  it("resends an invitation", async () => {
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
      resendPlatformTenantAdminInvitation("tenant_seifuu", "inv_001", "ja")
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

  it("cancels an invitation", async () => {
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
      cancelPlatformTenantAdminInvitation("tenant_seifuu", "inv_001", "ja")
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
