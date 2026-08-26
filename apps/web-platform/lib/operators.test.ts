import { Code, ConnectError } from "@publira/api-client/errors";
import type { PlatformApiClient } from "@publira/api-client/platform/client";
import type { PlatformOperator } from "@publira/api-client/platform/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPlatformOperator, listPlatformOperators } from "./operators";

type GetOperatorMethod = PlatformApiClient["operators"]["getOperator"];
type GetOperatorResponse = Awaited<ReturnType<GetOperatorMethod>>;
type ListOperatorsMethod = PlatformApiClient["operators"]["listOperators"];
type ListOperatorsResponse = Awaited<ReturnType<ListOperatorsMethod>>;

const createOperator = (
  overrides: Partial<Omit<PlatformOperator, "$typeName">> = {}
): PlatformOperator => ({
  $typeName: "publira.platform.v1.PlatformOperator",
  createdAt: "2026-08-01T00:00:00Z",
  email: "operator@example.com",
  name: "運営 太郎",
  publicId: "OPERATOR001",
  role: "platform_operator",
  status: "active",
  ...overrides,
});

const createListOperatorsResponse = ({
  nextToken = "",
  operators = [],
  previousToken = "",
}: {
  nextToken?: string;
  operators?: PlatformOperator[];
  previousToken?: string;
}): ListOperatorsResponse => ({
  $typeName: "publira.platform.v1.ListOperatorsResponse",
  nextToken,
  operators,
  previousToken,
});

const createGetOperatorResponse = (
  operator?: PlatformOperator
): GetOperatorResponse => ({
  $typeName: "publira.platform.v1.GetOperatorResponse",
  operator,
});

const {
  mockBuildSessionHeaders,
  mockGetOperator,
  mockListOperators,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockBuildSessionHeaders: vi.fn(),
  mockGetOperator: vi.fn<GetOperatorMethod>(),
  mockListOperators: vi.fn<ListOperatorsMethod>(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    operators: {
      getOperator: mockGetOperator,
      listOperators: mockListOperators,
    },
  },
  buildSessionHeaders: mockBuildSessionHeaders,
  resolveAccessToken: mockResolveAccessToken,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveAccessToken.mockResolvedValue("sess_abc");
  mockBuildSessionHeaders.mockImplementation((sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }));
});

describe("listPlatformOperators", () => {
  it("ページング引数を API に渡し、token と一覧を返す", async () => {
    mockListOperators.mockResolvedValueOnce(
      createListOperatorsResponse({
        nextToken: "next-page",
        operators: [createOperator()],
        previousToken: "previous-page",
      })
    );

    await expect(
      listPlatformOperators({ limit: 50, locale: "ja", token: "current-page" })
    ).resolves.toEqual({
      nextToken: "next-page",
      ok: true,
      operators: [
        {
          createdAt: "2026-08-01T00:00:00Z",
          email: "operator@example.com",
          name: "運営 太郎",
          publicId: "OPERATOR001",
          role: "platform_operator",
          status: "active",
        },
      ],
      previousToken: "previous-page",
    });
    expect(mockListOperators).toHaveBeenCalledWith(
      { limit: 50, token: "current-page" },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("session を解決できない場合は API を呼ばずエラーを返す", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(listPlatformOperators({ locale: "ja" })).resolves.toEqual({
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      operators: [],
      previousToken: "",
      requiresSignIn: true,
    });
    expect(mockListOperators).not.toHaveBeenCalled();
  });

  it("locale=en では英語のセッションエラーを返す", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(listPlatformOperators({ locale: "en" })).resolves.toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      nextToken: "",
      ok: false,
      operators: [],
      previousToken: "",
      requiresSignIn: true,
    });
  });

  it("分類済み RPC エラーは共通文言で返す", async () => {
    mockListOperators.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(listPlatformOperators({ locale: "ja" })).resolves.toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      nextToken: "",
      ok: false,
      operators: [],
      previousToken: "",
      requiresSignIn: false,
    });
  });

  it("分類できない RPC エラーは伝播する", async () => {
    mockListOperators.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(listPlatformOperators({ locale: "ja" })).rejects.toThrow(
      "boom"
    );
  });
});

describe("getPlatformOperator", () => {
  it("不正な入力は RPC を呼ばずに null を返す", async () => {
    await expect(getPlatformOperator("   ", "ja")).resolves.toBeNull();
    expect(mockGetOperator).not.toHaveBeenCalled();
    expect(mockResolveAccessToken).not.toHaveBeenCalled();
  });

  it("前後の空白を除いて GetOperator に渡す", async () => {
    mockGetOperator.mockResolvedValueOnce(
      createGetOperatorResponse(createOperator())
    );

    await expect(
      getPlatformOperator("  OPERATOR001  ", "ja")
    ).resolves.toMatchObject({
      publicId: "OPERATOR001",
    });
    expect(mockGetOperator).toHaveBeenCalledExactlyOnceWith(
      { publicId: "OPERATOR001" },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("一覧を走査せず GetOperator を1回だけ呼ぶ", async () => {
    mockGetOperator.mockResolvedValueOnce(
      createGetOperatorResponse(
        createOperator({
          email: "second@example.com",
          name: "運営 次郎",
          publicId: "OPERATOR101",
        })
      )
    );

    await expect(getPlatformOperator("OPERATOR101", "ja")).resolves.toEqual({
      createdAt: "2026-08-01T00:00:00Z",
      email: "second@example.com",
      name: "運営 次郎",
      publicId: "OPERATOR101",
      role: "platform_operator",
      status: "active",
    });
    expect(mockGetOperator).toHaveBeenCalledExactlyOnceWith(
      { publicId: "OPERATOR101" },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
    expect(mockListOperators).not.toHaveBeenCalled();
  });

  it("対象がなければ null を返す", async () => {
    mockGetOperator.mockRejectedValueOnce(
      new ConnectError("operator not found", Code.NotFound)
    );

    await expect(getPlatformOperator("UNKNOWN", "ja")).resolves.toBeNull();
  });

  it("分類済み RPC エラーは null を返す", async () => {
    mockGetOperator.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(getPlatformOperator("OPERATOR001", "ja")).resolves.toBeNull();
  });

  it("分類できない RPC エラーは伝播する", async () => {
    mockGetOperator.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(getPlatformOperator("OPERATOR001", "ja")).rejects.toThrow(
      "boom"
    );
  });
});
