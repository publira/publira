import { Code, ConnectError } from "@publira/api-client/errors";
import type { PlatformApiClient } from "@publira/api-client/platform/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPlatformOperator, listPlatformOperators } from "./operators";

type ListOperatorsMethod = PlatformApiClient["operators"]["listOperators"];
type ListOperatorsResponse = Awaited<ReturnType<ListOperatorsMethod>>;
type ListOperatorsResponseOperator = ListOperatorsResponse["operators"][number];

const createOperator = (
  overrides: Partial<Omit<ListOperatorsResponseOperator, "$typeName">> = {}
): ListOperatorsResponseOperator => ({
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
  operators?: ListOperatorsResponseOperator[];
  previousToken?: string;
}): ListOperatorsResponse => ({
  $typeName: "publira.platform.v1.ListOperatorsResponse",
  nextToken,
  operators,
  previousToken,
});

const { mockBuildSessionHeaders, mockListOperators, mockResolveAccessToken } =
  vi.hoisted(() => ({
    mockBuildSessionHeaders: vi.fn(),
    mockListOperators: vi.fn<ListOperatorsMethod>(),
    mockResolveAccessToken: vi.fn(),
  }));

vi.mock("./api-client", () => ({
  apiClient: {
    operators: {
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
      listPlatformOperators({ limit: 50, token: "current-page" })
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

    await expect(listPlatformOperators({})).resolves.toEqual({
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      operators: [],
      previousToken: "",
    });
    expect(mockListOperators).not.toHaveBeenCalled();
  });

  it("分類済み RPC エラーは共通文言で返す", async () => {
    mockListOperators.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(listPlatformOperators({})).resolves.toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      nextToken: "",
      ok: false,
      operators: [],
      previousToken: "",
    });
  });

  it("分類できない RPC エラーは伝播する", async () => {
    mockListOperators.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(listPlatformOperators({})).rejects.toThrow("boom");
  });
});

describe("getPlatformOperator", () => {
  it("次ページを辿って対象のオペレーターを返す", async () => {
    mockListOperators
      .mockResolvedValueOnce(
        createListOperatorsResponse({
          nextToken: "next-page",
          operators: [createOperator({ publicId: "OPERATOR001" })],
        })
      )
      .mockResolvedValueOnce(
        createListOperatorsResponse({
          operators: [
            createOperator({
              email: "second@example.com",
              name: "運営 次郎",
              publicId: "OPERATOR101",
            }),
          ],
          previousToken: "previous-page",
        })
      );

    await expect(getPlatformOperator("OPERATOR101")).resolves.toEqual({
      createdAt: "2026-08-01T00:00:00Z",
      email: "second@example.com",
      name: "運営 次郎",
      publicId: "OPERATOR101",
      role: "platform_operator",
      status: "active",
    });
    expect(mockListOperators).toHaveBeenNthCalledWith(
      1,
      { limit: 100, token: "" },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
    expect(mockListOperators).toHaveBeenNthCalledWith(
      2,
      { limit: 100, token: "next-page" },
      { headers: { Authorization: "Bearer sess_abc" } }
    );
  });

  it("全ページに対象がなければ null を返す", async () => {
    mockListOperators.mockResolvedValueOnce(
      createListOperatorsResponse({ operators: [createOperator()] })
    );

    await expect(getPlatformOperator("UNKNOWN")).resolves.toBeNull();
  });

  it("分類済み RPC エラーは null を返す", async () => {
    mockListOperators.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(getPlatformOperator("OPERATOR001")).resolves.toBeNull();
  });

  it("分類できない RPC エラーは伝播する", async () => {
    mockListOperators.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(getPlatformOperator("OPERATOR001")).rejects.toThrow("boom");
  });
});
