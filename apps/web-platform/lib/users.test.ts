import { beforeEach, describe, expect, it, vi } from "vitest";

import { listPlatformEndUsers, listPlatformTenantFilterOptions } from "./users";

const {
  mockListEndUsers,
  mockListTenantMembers,
  mockListTenants,
  mockResolveSessionId,
} = vi.hoisted(() => ({
  mockListEndUsers: vi.fn(),
  mockListTenantMembers: vi.fn(),
  mockListTenants: vi.fn(),
  mockResolveSessionId: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    tenants: {
      listTenantMembers: mockListTenantMembers,
      listTenants: mockListTenants,
    },
    users: {
      listEndUsers: mockListEndUsers,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveSessionId,
}));

const sessionHeaders = {
  headers: { Authorization: "Bearer sess_abc" },
};

describe("listPlatformEndUsers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockResolveSessionId.mockResolvedValue("sess_abc");
  });

  it("テナント未指定でも tenant_public_id なしで一覧し、メンバーは tenantPublicId で取る", async () => {
    mockListEndUsers.mockResolvedValueOnce({
      users: [
        {
          createdAt: "2026-03-01T00:00:00Z",
          email: "enduser@example.com",
          name: "End User",
          primaryTenantName: "tenant_a",
          primaryTenantPublicId: "tenant_a",
          publicId: "ENDUSER001",
          status: "active",
          tenantIds: ["tenant_a"],
        },
      ],
    });
    mockListTenants.mockResolvedValueOnce({
      nextToken: "",
      tenants: [{ name: "Tenant A", publicId: "tenant_a" }],
    });
    mockListTenantMembers.mockResolvedValueOnce({ members: [] });

    await expect(
      listPlatformEndUsers({ limit: 20, offset: 0 })
    ).resolves.toEqual({
      ok: true,
      users: [
        {
          createdAt: "2026-03-01T00:00:00Z",
          email: "enduser@example.com",
          name: "End User",
          primaryTenantName: "Tenant A",
          primaryTenantPublicId: "tenant_a",
          publicId: "ENDUSER001",
          status: "active",
          tenantIds: ["tenant_a"],
        },
      ],
    });

    expect(mockListEndUsers).toHaveBeenCalledWith(
      {
        createdAfter: "",
        createdBefore: "",
        limit: 20,
        offset: 0,
        publicIds: [],
        status: "",
      },
      sessionHeaders
    );
    expect(mockListTenants).toHaveBeenCalledWith(
      {
        limit: 100,
        name: "",
        publicId: "",
        status: "",
        token: "",
      },
      sessionHeaders
    );
    expect(mockListTenantMembers).toHaveBeenCalledWith(
      {
        limit: 100,
        offset: 0,
        tenantPublicId: "tenant_a",
      },
      sessionHeaders
    );
  });

  it("end-user API が空でも tenant members を表示する", async () => {
    mockListEndUsers.mockResolvedValueOnce({ users: [] });
    mockListTenants.mockResolvedValueOnce({
      nextToken: "",
      tenants: [
        { name: "tenant_a", publicId: "tenant_a" },
        { name: "tenant_b", publicId: "tenant_b" },
      ],
    });

    mockListTenantMembers
      .mockResolvedValueOnce({
        members: [
          {
            createdAt: "2026-03-02T00:00:00Z",
            email: "alice@example.com",
            name: "Alice",
            role: "tenant_admin",
            status: "active",
            userPublicId: "USER000001",
          },
        ],
      })
      .mockResolvedValueOnce({
        members: [
          {
            createdAt: "2026-03-03T00:00:00Z",
            email: "bob@example.com",
            name: "Bob",
            role: "tenant_editor",
            status: "active",
            userPublicId: "USER000002",
          },
        ],
      });

    await expect(
      listPlatformEndUsers({ limit: 20, offset: 0 })
    ).resolves.toEqual({
      ok: true,
      users: [
        {
          createdAt: "2026-03-03T00:00:00Z",
          email: "bob@example.com",
          name: "Bob",
          primaryTenantName: "tenant_b",
          primaryTenantPublicId: "tenant_b",
          publicId: "USER000002",
          status: "active",
          tenantIds: ["tenant_b"],
        },
        {
          createdAt: "2026-03-02T00:00:00Z",
          email: "alice@example.com",
          name: "Alice",
          primaryTenantName: "tenant_a",
          primaryTenantPublicId: "tenant_a",
          publicId: "USER000001",
          status: "active",
          tenantIds: ["tenant_a"],
        },
      ],
    });

    expect(mockListTenantMembers).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        offset: 0,
        tenantPublicId: "tenant_a",
      },
      sessionHeaders
    );
    expect(mockListTenantMembers).toHaveBeenNthCalledWith(
      2,
      {
        limit: 100,
        offset: 0,
        tenantPublicId: "tenant_b",
      },
      sessionHeaders
    );
  });

  it("テナント絞り込み時も指定テナントの tenantPublicId でメンバーを取る", async () => {
    mockListEndUsers.mockResolvedValueOnce({ users: [] });
    mockListTenants.mockResolvedValueOnce({
      nextToken: "",
      tenants: [
        { name: "Tenant A", publicId: "tenant_a" },
        { name: "Tenant B", publicId: "tenant_b" },
      ],
    });
    mockListTenantMembers.mockResolvedValueOnce({
      members: [
        {
          createdAt: "2026-03-02T00:00:00Z",
          email: "alice@example.com",
          name: "Alice",
          role: "tenant_admin",
          status: "active",
          userPublicId: "USER000001",
        },
      ],
    });

    await expect(
      listPlatformEndUsers({
        limit: 20,
        offset: 0,
        tenantId: "tenant_a",
      })
    ).resolves.toEqual({
      ok: true,
      users: [
        {
          createdAt: "2026-03-02T00:00:00Z",
          email: "alice@example.com",
          name: "Alice",
          primaryTenantName: "Tenant A",
          primaryTenantPublicId: "tenant_a",
          publicId: "USER000001",
          status: "active",
          tenantIds: ["tenant_a"],
        },
      ],
    });

    expect(mockListTenantMembers).toHaveBeenCalledTimes(1);
    expect(mockListTenantMembers).toHaveBeenCalledWith(
      {
        limit: 100,
        offset: 0,
        tenantPublicId: "tenant_a",
      },
      sessionHeaders
    );
  });

  it("メンバー走査が上限で途切れたときは成功にしない", async () => {
    mockListEndUsers.mockResolvedValueOnce({ users: [] });
    mockListTenants.mockResolvedValueOnce({
      nextToken: "",
      tenants: [{ name: "Tenant A", publicId: "tenant_a" }],
    });
    mockListTenantMembers.mockResolvedValue({
      members: Array.from({ length: 100 }, (_, index) => ({
        createdAt: "2026-03-02T00:00:00Z",
        email: `user${index}@example.com`,
        name: `User ${index}`,
        role: "tenant_admin",
        status: "active",
        userPublicId: `USER${String(index).padStart(6, "0")}`,
      })),
    });

    await expect(
      listPlatformEndUsers({ limit: 20, offset: 0 })
    ).resolves.toEqual({
      message:
        "ユーザー一覧の取得に失敗しました。時間をおいて再試行してください。",
      ok: false,
    });
    expect(mockListTenantMembers).toHaveBeenCalledTimes(100);
  });
});

describe("listPlatformTenantFilterOptions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockResolveSessionId.mockResolvedValue("sess_abc");
  });

  it("cursor でテナントを辿って絞り込み選択肢を返す", async () => {
    mockListTenants
      .mockResolvedValueOnce({
        nextToken: "page-2",
        tenants: [{ name: "Tenant A", publicId: "tenant_a" }],
      })
      .mockResolvedValueOnce({
        nextToken: "",
        tenants: [{ name: "Tenant B", publicId: "tenant_b" }],
      });

    await expect(listPlatformTenantFilterOptions()).resolves.toEqual([
      { name: "Tenant A", publicId: "tenant_a" },
      { name: "Tenant B", publicId: "tenant_b" },
    ]);

    expect(mockListTenants).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        name: "",
        publicId: "",
        status: "",
        token: "",
      },
      sessionHeaders
    );
    expect(mockListTenants).toHaveBeenNthCalledWith(
      2,
      {
        limit: 100,
        name: "",
        publicId: "",
        status: "",
        token: "page-2",
      },
      sessionHeaders
    );
  });

  it("テナント走査が上限で途切れたときは空の選択肢を返す", async () => {
    let page = 0;
    mockListTenants.mockImplementation(() => {
      page += 1;
      return {
        nextToken: `page-${page}`,
        tenants: [{ name: "Tenant A", publicId: "tenant_a" }],
      };
    });

    await expect(listPlatformTenantFilterOptions()).resolves.toEqual([]);
    expect(mockListTenants).toHaveBeenCalledTimes(100);
  });
});
