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
  it("正常系: 監査ログ一覧を返す", async () => {
    mockListAuditLogs.mockResolvedValueOnce({
      auditLogs: [
        {
          action: "tenant.created",
          actorName: "運営 太郎",
          actorRole: "platform_owner",
          actorUserPublicId: "op_001",
          createdAt: "2026-03-24T01:23:45Z",
          outcome: "success",
          reason: "",
          targetId: "tenant_001",
          targetName: "テナントA",
          targetPublicId: "tenant_001",
          targetType: "tenant",
          tenantName: "テナントA",
          tenantPublicId: "tenant_001",
        },
      ],
    });

    await expect(listPlatformAuditLogs({ locale: "ja" })).resolves.toEqual({
      auditLogs: [
        {
          action: "tenant.created",
          actorName: "運営 太郎",
          actorRole: "platform_owner",
          actorUserPublicId: "op_001",
          createdAt: "2026-03-24T01:23:45Z",
          outcome: "success",
          reason: "",
          targetId: "tenant_001",
          targetName: "テナントA",
          targetPublicId: "tenant_001",
          targetType: "tenant",
          tenantId: "tenant_001",
          tenantName: "テナントA",
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

  it("応答の previousToken / nextToken をそのまま返す", async () => {
    mockListAuditLogs.mockResolvedValueOnce({
      auditLogs: [
        {
          action: "tenant.created",
          actorName: "運営 太郎",
          actorRole: "platform_owner",
          actorUserPublicId: "op_001",
          createdAt: "2026-03-24T01:23:45Z",
          outcome: "success",
          reason: "",
          targetId: "tenant_001",
          targetName: "テナントA",
          targetPublicId: "tenant_001",
          targetType: "tenant",
          tenantName: "テナントA",
          tenantPublicId: "tenant_001",
        },
      ],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    await expect(
      listPlatformAuditLogs({ locale: "ja", token: "current-page" })
    ).resolves.toEqual({
      auditLogs: [
        {
          action: "tenant.created",
          actorName: "運営 太郎",
          actorRole: "platform_owner",
          actorUserPublicId: "op_001",
          createdAt: "2026-03-24T01:23:45Z",
          outcome: "success",
          reason: "",
          targetId: "tenant_001",
          targetName: "テナントA",
          targetPublicId: "tenant_001",
          targetType: "tenant",
          tenantId: "tenant_001",
          tenantName: "テナントA",
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

  it("tenant / actor / action フィルターを API に渡す", async () => {
    mockListAuditLogs.mockResolvedValueOnce({ auditLogs: [] });

    await expect(
      listPlatformAuditLogs({
        action: "tenant.status.updated",
        actorUserPublicId: "op_123",
        limit: 20,
        locale: "ja",
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

  it("tenant 情報が空でも監査ログを返せる", async () => {
    mockListAuditLogs.mockResolvedValueOnce({
      auditLogs: [
        {
          action: "operator.signed_in",
          actorName: "運営 次郎",
          actorRole: "platform_owner",
          actorUserPublicId: "op_002",
          createdAt: "2026-03-25T02:34:56Z",
          outcome: "success",
          reason: "",
          targetId: "op_002",
          targetName: "運営 次郎",
          targetPublicId: "",
          targetType: "operator",
          tenantId: undefined,
          tenantName: undefined,
        },
      ],
    });

    await expect(listPlatformAuditLogs({ locale: "ja" })).resolves.toEqual({
      auditLogs: [
        {
          action: "operator.signed_in",
          actorName: "運営 次郎",
          actorRole: "platform_owner",
          actorUserPublicId: "op_002",
          createdAt: "2026-03-25T02:34:56Z",
          outcome: "success",
          reason: "",
          targetId: "op_002",
          targetName: "運営 次郎",
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

  it("sessionId を解決できない場合は API を呼ばずエラーを返す", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(listPlatformAuditLogs({ locale: "ja" })).resolves.toEqual({
      auditLogs: [],
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    });

    expect(mockListAuditLogs).not.toHaveBeenCalled();
  });

  it("locale=en では英語のセッションエラーを返す", async () => {
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

  it("到達不能エラーは共通文言で返す", async () => {
    mockListAuditLogs.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(listPlatformAuditLogs({ locale: "ja" })).resolves.toEqual({
      auditLogs: [],
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
  });

  it("分類できない RPC エラーは伝播する", async () => {
    mockListAuditLogs.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(listPlatformAuditLogs({ locale: "ja" })).rejects.toThrow(
      "boom"
    );
  });
});
