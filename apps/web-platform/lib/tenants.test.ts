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
  platformTenantCacheTag,
  platformTenantsCacheTag,
  resendPlatformTenantAdminInvitation,
  removePlatformTenantMember,
  resumePlatformTenant,
  suspendPlatformTenant,
  updatePlatformTenant,
  updatePlatformTenantMemberRole,
} from "./tenants";

const tenantId = "01a0deb5-0000-7000-8000-000000000002";

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
  mockCacheLife,
  mockCacheTag,
  mockCreateTenant,
  mockCreateTenantAdminInvitation,
  mockGetPlatformLocale,
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
  mockUpdateTenant,
  mockUpdateTenantMemberRole,
  mockCancelTenantAdminInvitation,
  mockVerifyPlatformSession,
} = vi.hoisted(() => ({
  mockAddTenantMember: vi.fn(),
  mockBuildSessionHeaders: vi.fn(),
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockCancelTenantAdminInvitation: vi.fn(),
  mockCreateTenant: vi.fn(),
  mockCreateTenantAdminInvitation: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
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
  mockUpdateTenant: vi.fn(),
  mockUpdateTenantMemberRole: vi.fn(),
  mockVerifyPlatformSession: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./auth-session", () => ({
  verifyPlatformSession: mockVerifyPlatformSession,
}));

vi.mock("./locale", () => ({
  getPlatformLocale: mockGetPlatformLocale,
}));

vi.mock("./api-client", () => ({
  SHARED_READ_CACHE_LIFE: "minutes",
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
      updateTenant: mockUpdateTenant,
      updateTenantMemberRole: mockUpdateTenantMemberRole,
    },
    users: {
      listEndUsers: mockListUsers,
    },
  },
  buildSessionHeaders: mockBuildSessionHeaders,
  resolveAccessToken: mockResolveSessionId,
  withServiceHeaders: () => ({
    headers: { Authorization: "Bearer service-token" },
  }),
}));

const serviceHeaders = { headers: { Authorization: "Bearer service-token" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSessionId.mockResolvedValue("sess_abc");
  mockBuildSessionHeaders.mockImplementation((sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }));
  mockGetPlatformLocale.mockResolvedValue("en");
  mockVerifyPlatformSession.mockResolvedValue({
    name: "Admin",
    publicId: "usr_1",
    role: "platform_super_admin",
  });
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
            id: "01a0deb5-0000-7000-8000-000000000001",
            name: "Test Publishing",
            publicId: "tenant_test",
            status: "active",
          },
        ],
      })
    );

    await expect(listPlatformTenants()).resolves.toEqual({
      nextToken: "next-page",
      ok: true,
      previousToken: "",
      tenants: [
        {
          adminDomain: "admin.example.com",
          createdAt: "2026-03-01 10:00",
          domain: "example.com",
          name: "Test Publishing",
          publicId: "tenant_test",
          status: "active",
        },
      ],
    });

    expect(mockListTenants).toHaveBeenCalledWith(
      { limit: 20, name: "", status: "", token: "" },
      serviceHeaders
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
        name: "Test",
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
        name: "Test",
        status: "active",
        token: "current-page",
      },
      serviceHeaders
    );
  });

  it("leaves the API uncalled when the session is rejected", async () => {
    mockVerifyPlatformSession.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT:/login")
    );

    await expect(listPlatformTenants()).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockListTenants).not.toHaveBeenCalled();
  });

  it("returns a shared message for unavailable errors", async () => {
    mockListTenants.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(listPlatformTenants()).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      nextToken: "",
      ok: false,
      previousToken: "",
      tenants: [],
    });
  });

  it("returns an unclassified failure as a value instead of throwing inside the cache scope", async () => {
    mockListTenants.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(listPlatformTenants()).resolves.toMatchObject({
      ok: false,
      tenants: [],
    });
    expect(mockCacheLife).toHaveBeenLastCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
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
        locale: "en",
        name: "New Publishing",
      })
    ).resolves.toEqual({ ok: true, publicId: "TENANT000001" });

    expect(mockCreateTenant).toHaveBeenCalledWith(
      {
        adminDomain: "",
        defaultLocale: "ja",
        domain: "example.com",
        initialAdminEmails: ["owner@example.com"],
        name: "New Publishing",
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
        locale: "en",
        name: "n",
      })
    ).resolves.toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
    });

    expect(mockCreateTenant).not.toHaveBeenCalled();
  });

  it.each([
    {
      reason: "domain already exists",
      title: "domain conflicts without details",
    },
    {
      reason: "admin_domain already exists",
      title: "admin domain conflicts without details",
    },
    {
      reason: "duplicate key",
      title: "conflicts that name neither domain",
    },
  ])("uses a generic message for $title", async ({ reason }) => {
    mockCreateTenant.mockRejectedValueOnce(
      new ConnectError(reason, Code.AlreadyExists)
    );

    await expect(
      createPlatformTenant({
        defaultLocale: "ja",
        domain: "example.com",
        locale: "en",
        name: "n",
      })
    ).resolves.toEqual({
      message: "Cannot create because this data already exists.",
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
        locale: "en",
        name: "n",
      })
    ).resolves.toEqual({
      message: "This domain is already in use.",
      ok: false,
    });
  });

  it("words the domain conflict in the requested locale, so locale=ja is Japanese", async () => {
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
        locale: "en",
        name: "n",
      })
    ).resolves.toEqual({
      message: "This admin domain is already in use.",
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
        locale: "en",
        name: "n",
      })
    ).resolves.toEqual({
      message: "The submitted values are invalid. Check them and try again.",
      ok: false,
    });
  });

  it("fetches and formats tenant details", async () => {
    mockGetTenant.mockResolvedValueOnce({
      tenant: {
        adminDomain: "admin.example.com",
        createdAt: "2026-03-01T10:00:00Z",
        domain: "example.com",
        id: tenantId,
        name: "Blue Maple Press",
        publicId: "tenant_bluemaple",
        status: "active",
      },
    });

    await expect(getPlatformTenant("tenant_bluemaple")).resolves.toEqual({
      ok: true,
      tenant: {
        adminDomain: "admin.example.com",
        createdAt: "2026-03-01T10:00:00Z",
        domain: "example.com",
        id: tenantId,
        name: "Blue Maple Press",
        publicId: "tenant_bluemaple",
        status: "active",
      },
    });

    expect(mockGetTenant).toHaveBeenCalledWith(
      { publicId: "tenant_bluemaple" },
      serviceHeaders
    );
  });

  it("returns tenant: null rather than a failure for a missing tenant", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("tenant not found", Code.NotFound)
    );

    await expect(getPlatformTenant("tenant_missing")).resolves.toEqual({
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

    await expect(getPlatformTenant("tenant_bluemaple")).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
  });

  it("leaves GetTenant uncalled when the session is rejected", async () => {
    mockVerifyPlatformSession.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT:/login")
    );

    await expect(getPlatformTenant("tenant_bluemaple")).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(mockGetTenant).not.toHaveBeenCalled();
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
          userId: "01a0deb5-0000-7000-8000-000000000003",
        },
      ],
    });

    await expect(listPlatformTenantMembers({ tenantId })).resolves.toEqual({
      members: [
        {
          createdAt: "2026-03-02T00:00:00Z",
          email: "owner@example.com",
          name: "Owner",
          role: "tenant_owner",
          status: "active",
          userId: "01a0deb5-0000-7000-8000-000000000003",
        },
      ],
      nextToken: "",
      ok: true,
      previousToken: "",
    });

    expect(mockListTenantMembers).toHaveBeenCalledWith(
      { limit: 20, tenantId, token: "" },
      serviceHeaders
    );
  });

  it("leaves ListTenantMembers uncalled when the session is rejected", async () => {
    mockVerifyPlatformSession.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT:/login")
    );

    await expect(listPlatformTenantMembers({ tenantId })).rejects.toThrow(
      /NEXT_REDIRECT/u
    );
    expect(mockListTenantMembers).not.toHaveBeenCalled();
  });

  it("calls the suspend or resume API as appropriate", async () => {
    mockSuspendTenant.mockResolvedValueOnce({});
    mockResumeTenant.mockResolvedValueOnce({});

    await expect(suspendPlatformTenant(tenantId)).resolves.toBe(true);
    await expect(resumePlatformTenant(tenantId)).resolves.toBe(true);

    expect(mockSuspendTenant).toHaveBeenCalledWith(
      { tenantId },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
    expect(mockResumeTenant).toHaveBeenCalledWith(
      { tenantId },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("adds a member by email to the tenant named by its internal ID", async () => {
    mockAddTenantMember.mockResolvedValueOnce({});

    await expect(
      addPlatformTenantMember({
        email: "member@example.com",
        locale: "en",
        role: "tenant_admin",
        tenantId,
      })
    ).resolves.toEqual({ ok: true });

    expect(mockAddTenantMember).toHaveBeenCalledWith(
      {
        email: "member@example.com",
        role: "tenant_admin",
        tenantId,
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("normalizes email to lowercase when adding a member", async () => {
    mockAddTenantMember.mockResolvedValueOnce({});

    await expect(
      addPlatformTenantMember({
        email: "Member@Example.COM",
        locale: "en",
        role: "tenant_admin",
        tenantId,
      })
    ).resolves.toEqual({ ok: true });

    expect(mockAddTenantMember).toHaveBeenCalledWith(
      {
        email: "member@example.com",
        role: "tenant_admin",
        tenantId,
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("names the tenant and the member by their internal IDs", async () => {
    const userId = "01a0deb5-0000-7000-8000-000000000003";
    mockUpdateTenantMemberRole.mockResolvedValueOnce({});
    mockRemoveTenantMember.mockResolvedValueOnce({});

    await expect(
      updatePlatformTenantMemberRole(tenantId, userId, "tenant_auditor", "en")
    ).resolves.toEqual({ ok: true });
    await expect(
      removePlatformTenantMember(tenantId, userId, "en")
    ).resolves.toEqual({ ok: true });

    expect(mockUpdateTenantMemberRole).toHaveBeenCalledWith(
      { role: "tenant_auditor", tenantId, userId },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
    expect(mockRemoveTenantMember).toHaveBeenCalledWith(
      { tenantId, userId },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("sends only the fields the change carries", async () => {
    mockUpdateTenant.mockResolvedValueOnce({}).mockResolvedValueOnce({});

    await expect(
      updatePlatformTenant(tenantId, { name: " Blue Maple " }, "en")
    ).resolves.toEqual({ ok: true });
    await expect(
      updatePlatformTenant(
        tenantId,
        { adminDomain: "", domain: "example.com" },
        "en"
      )
    ).resolves.toEqual({ ok: true });

    expect(mockUpdateTenant.mock.calls).toEqual([
      [
        { name: "Blue Maple", tenantId },
        { headers: { Authorization: "Bearer sess_abc" } },
      ],
      [
        { adminDomain: "", domain: "example.com", tenantId },
        { headers: { Authorization: "Bearer sess_abc" } },
      ],
    ]);
  });

  it("returns a not-found error when the user is not in the tenant", async () => {
    mockAddTenantMember.mockRejectedValueOnce(
      new ConnectError("member not found", Code.NotFound)
    );

    await expect(
      addPlatformTenantMember({
        email: "member@example.com",
        locale: "en",
        role: "tenant_admin",
        tenantId,
      })
    ).resolves.toEqual({
      message: "No user was found with that email address.",
      ok: false,
    });
  });
});

describe("tenant admin invitations", () => {
  it("fetches invitations with the role each one grants", async () => {
    mockListTenantAdminInvitations.mockResolvedValueOnce({
      invitations: [
        {
          acceptedAt: "",
          canceledAt: "",
          createdAt: "2026-03-30T00:00:00Z",
          email: "editor@example.com",
          expiresAt: "2026-03-31T00:00:00Z",
          id: "inv_001",
          role: "tenant_editor",
          status: "pending",
        },
      ],
      nextToken: "next-page",
      previousToken: "",
    });

    await expect(
      listPlatformTenantAdminInvitations({ tenantId })
    ).resolves.toEqual({
      invitations: [
        {
          acceptedAt: "",
          canceledAt: "",
          createdAt: "2026-03-30T00:00:00Z",
          email: "editor@example.com",
          expiresAt: "2026-03-31T00:00:00Z",
          id: "inv_001",
          role: "tenant_editor",
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
        tenantId,
        token: "",
      },
      serviceHeaders
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
        tenantId,
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
        tenantId,
        token: "current-page",
      },
      serviceHeaders
    );
  });

  it("leaves the API uncalled when the session is rejected", async () => {
    mockVerifyPlatformSession.mockRejectedValueOnce(
      new Error("NEXT_REDIRECT:/login")
    );

    await expect(
      listPlatformTenantAdminInvitations({ tenantId })
    ).rejects.toThrow(/NEXT_REDIRECT/u);
    expect(mockListTenantAdminInvitations).not.toHaveBeenCalled();
  });

  it("returns a shared message for unavailable errors", async () => {
    mockListTenantAdminInvitations.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(
      listPlatformTenantAdminInvitations({ tenantId })
    ).resolves.toEqual({
      invitations: [],
      message: "Could not connect to the server. Please try again later.",
      nextToken: "",
      ok: false,
      previousToken: "",
    });
  });

  it("returns an unclassified failure as a value instead of throwing inside the cache scope", async () => {
    mockListTenantAdminInvitations.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      listPlatformTenantAdminInvitations({ tenantId })
    ).resolves.toMatchObject({ invitations: [], ok: false });
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
        role: "tenant_admin",
        status: "pending",
      },
      roleGrantedImmediately: false,
    });

    await expect(
      createPlatformTenantAdminInvitation(tenantId, "admin@example.com", "ja")
    ).resolves.toEqual({
      invitation: {
        acceptedAt: "",
        canceledAt: "",
        createdAt: "2026-03-30T00:00:00Z",
        email: "admin@example.com",
        expiresAt: "2026-03-31T00:00:00Z",
        id: "inv_001",
        role: "tenant_admin",
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
        role: "tenant_admin",
        status: "pending",
      },
    });

    await expect(
      resendPlatformTenantAdminInvitation(tenantId, "inv_001", "ja")
    ).resolves.toEqual({
      invitation: {
        acceptedAt: "",
        canceledAt: "",
        createdAt: "2026-03-30T00:00:00Z",
        email: "admin@example.com",
        expiresAt: "2026-03-31T00:00:00Z",
        id: "inv_001",
        role: "tenant_admin",
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
        role: "tenant_admin",
        status: "canceled",
      },
    });

    await expect(
      cancelPlatformTenantAdminInvitation(tenantId, "inv_001", "ja")
    ).resolves.toEqual({
      invitation: {
        acceptedAt: "",
        canceledAt: "2026-03-30T01:00:00Z",
        createdAt: "2026-03-30T00:00:00Z",
        email: "admin@example.com",
        expiresAt: "2026-03-31T00:00:00Z",
        id: "inv_001",
        role: "tenant_admin",
        status: "canceled",
      },
      ok: true,
    });
  });
});

describe("tenant cache tags", () => {
  it("files the tenant list under the tenants tag", async () => {
    mockListTenants.mockResolvedValueOnce(createListTenantsResponse({}));

    await listPlatformTenants();

    expect(mockCacheTag).toHaveBeenCalledWith(platformTenantsCacheTag);
    // Refreshed after a minute: `publiractl tenant` writes tenants straight
    // to Postgres, which clears no tag here.
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
  });

  it("files a tenant's detail under the tenants tag and its internal ID's", async () => {
    mockGetTenant.mockResolvedValueOnce({
      tenant: { id: tenantId, publicId: "tenant_bluemaple" },
    });

    await getPlatformTenant("tenant_bluemaple");

    expect(mockCacheTag).toHaveBeenCalledWith("platform:tenants");
    expect(mockCacheTag).toHaveBeenCalledWith(`platform:tenants:${tenantId}`);
  });

  it("files a tenant's members under the tenants tag and the tenant's own", async () => {
    mockListTenantMembers.mockResolvedValueOnce({ members: [] });

    await listPlatformTenantMembers({ tenantId });

    expect(mockCacheTag).toHaveBeenCalledWith(
      platformTenantsCacheTag,
      platformTenantCacheTag(tenantId)
    );
    // Refreshed after a minute: tenant admins change their members from
    // their own console, which clears no tag here.
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
  });

  it("files a tenant's invitations under the tenants tag and the tenant's own", async () => {
    mockListTenantAdminInvitations.mockResolvedValueOnce({ invitations: [] });

    await listPlatformTenantAdminInvitations({ tenantId });

    expect(mockCacheTag).toHaveBeenCalledWith(
      platformTenantsCacheTag,
      platformTenantCacheTag(tenantId)
    );
    // Refreshed after a minute: an invitee accepts from a link, and a
    // pending invitation expires with time.
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
  });
});
