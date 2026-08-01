import { beforeEach, describe, expect, it, vi } from "vitest";

import { listPlatformEndUsers } from "./users";

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

describe("listPlatformEndUsers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockResolveSessionId.mockResolvedValue("sess_abc");
  });

  it("end-user と tenant members を統合して返す", async () => {
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
    mockListTenants
      .mockResolvedValueOnce({
        tenants: [{ publicId: "tenant_a" }],
      })
      .mockResolvedValueOnce({ tenants: [] });
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
          primaryTenantName: "tenant_a",
          primaryTenantPublicId: "tenant_a",
          publicId: "ENDUSER001",
          status: "active",
          tenantIds: ["tenant_a"],
        },
      ],
    });
  });

  it("end-user API が空でも tenant members を表示する", async () => {
    mockListEndUsers.mockResolvedValueOnce({ users: [] });
    mockListTenants
      .mockResolvedValueOnce({
        tenants: [{ publicId: "tenant_a" }, { publicId: "tenant_b" }],
      })
      .mockResolvedValueOnce({ tenants: [] });

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
  });
});
