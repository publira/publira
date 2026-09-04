import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listPlatformAuditLogs } from "./audit-logs";

const { mockBuildSessionHeaders, mockListAuditLogs, mockResolveSessionId } =
  vi.hoisted(() => ({
    mockBuildSessionHeaders: vi.fn(),
    mockListAuditLogs: vi.fn(),
    mockResolveSessionId: vi.fn(),
  }));

vi.mock("./api-client", () => ({
  apiClient: {
    auditLogs: {
      listAuditLogs: mockListAuditLogs,
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

describe("listPlatformAuditLogs", () => {
  it("returns audit logs", async () => {
    mockListAuditLogs.mockResolvedValueOnce({
      auditLogs: [
        {
          action: "tenant.created",
          actorName: "Taylor Reed",
          actorRole: "platform_owner",
          actorUserPublicId: "op_001",
          createdAt: "2026-03-24T01:23:45Z",
          outcome: "success",
          reason: "",
          targetId: "tenant_001",
          targetName: "Tenant A",
          targetPublicId: "tenant_001",
          targetType: "tenant",
          tenantName: "Tenant A",
          tenantPublicId: "tenant_001",
        },
      ],
    });

    await expect(listPlatformAuditLogs({ locale: "en" })).resolves.toEqual({
      auditLogs: [
        {
          action: "tenant.created",
          actorName: "Taylor Reed",
          actorRole: "platform_owner",
          actorUserPublicId: "op_001",
          createdAt: "2026-03-24T01:23:45Z",
          outcome: "success",
          reason: "",
          targetId: "tenant_001",
          targetName: "Tenant A",
          targetPublicId: "tenant_001",
          targetType: "tenant",
          tenantId: "tenant_001",
          tenantName: "Tenant A",
        },
      ],
      nextToken: "",
      ok: true,
      previousToken: "",
    });

    expect(mockListAuditLogs).toHaveBeenCalledWith(
      {
        action: "",
        actorUserPublicId: "",
        limit: 100,
        tenantId: "",
        token: "",
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("returns previousToken and nextToken from the response unchanged", async () => {
    mockListAuditLogs.mockResolvedValueOnce({
      auditLogs: [
        {
          action: "tenant.created",
          actorName: "Taylor Reed",
          actorRole: "platform_owner",
          actorUserPublicId: "op_001",
          createdAt: "2026-03-24T01:23:45Z",
          outcome: "success",
          reason: "",
          targetId: "tenant_001",
          targetName: "Tenant A",
          targetPublicId: "tenant_001",
          targetType: "tenant",
          tenantName: "Tenant A",
          tenantPublicId: "tenant_001",
        },
      ],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    await expect(
      listPlatformAuditLogs({ locale: "en", token: "current-page" })
    ).resolves.toEqual({
      auditLogs: [
        {
          action: "tenant.created",
          actorName: "Taylor Reed",
          actorRole: "platform_owner",
          actorUserPublicId: "op_001",
          createdAt: "2026-03-24T01:23:45Z",
          outcome: "success",
          reason: "",
          targetId: "tenant_001",
          targetName: "Tenant A",
          targetPublicId: "tenant_001",
          targetType: "tenant",
          tenantId: "tenant_001",
          tenantName: "Tenant A",
        },
      ],
      nextToken: "next-page",
      ok: true,
      previousToken: "previous-page",
    });

    expect(mockListAuditLogs).toHaveBeenCalledWith(
      {
        action: "",
        actorUserPublicId: "",
        limit: 100,
        tenantId: "",
        token: "current-page",
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("passes tenant, actor, and action filters to the API", async () => {
    mockListAuditLogs.mockResolvedValueOnce({ auditLogs: [] });

    await expect(
      listPlatformAuditLogs({
        action: "tenant.status.updated",
        actorUserPublicId: "op_123",
        limit: 20,
        locale: "en",
        tenantId: "tenant_999",
        token: "page-2",
      })
    ).resolves.toEqual({
      auditLogs: [],
      nextToken: "",
      ok: true,
      previousToken: "",
    });

    expect(mockListAuditLogs).toHaveBeenCalledWith(
      {
        action: "tenant.status.updated",
        actorUserPublicId: "op_123",
        limit: 20,
        tenantId: "tenant_999",
        token: "page-2",
      },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("returns audit logs when tenant information is empty", async () => {
    mockListAuditLogs.mockResolvedValueOnce({
      auditLogs: [
        {
          action: "operator.signed_in",
          actorName: "Jordan Blake",
          actorRole: "platform_owner",
          actorUserPublicId: "op_002",
          createdAt: "2026-03-25T02:34:56Z",
          outcome: "success",
          reason: "",
          targetId: "op_002",
          targetName: "Jordan Blake",
          targetPublicId: "",
          targetType: "operator",
          tenantId: undefined,
          tenantName: undefined,
        },
      ],
    });

    await expect(listPlatformAuditLogs({ locale: "en" })).resolves.toEqual({
      auditLogs: [
        {
          action: "operator.signed_in",
          actorName: "Jordan Blake",
          actorRole: "platform_owner",
          actorUserPublicId: "op_002",
          createdAt: "2026-03-25T02:34:56Z",
          outcome: "success",
          reason: "",
          targetId: "op_002",
          targetName: "Jordan Blake",
          targetPublicId: "",
          targetType: "operator",
          tenantId: "",
          tenantName: "",
        },
      ],
      nextToken: "",
      ok: true,
      previousToken: "",
    });
  });

  it("returns an error without calling the API when sessionId cannot be resolved", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(listPlatformAuditLogs({ locale: "en" })).resolves.toEqual({
      auditLogs: [],
      message: "Your session is no longer valid. Please sign in again.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    });

    expect(mockListAuditLogs).not.toHaveBeenCalled();
  });

  it("returns an English session error for locale=en", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(listPlatformAuditLogs({ locale: "en" })).resolves.toEqual({
      auditLogs: [],
      message: "Your session is no longer valid. Please sign in again.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    });
  });

  it("returns a shared message for unavailable errors", async () => {
    mockListAuditLogs.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(listPlatformAuditLogs({ locale: "en" })).resolves.toEqual({
      auditLogs: [],
      message: "Could not connect to the server. Please try again later.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
  });

  it("propagates unclassified RPC errors", async () => {
    mockListAuditLogs.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(listPlatformAuditLogs({ locale: "en" })).rejects.toThrow(
      "boom"
    );
  });
});
