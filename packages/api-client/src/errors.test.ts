import { ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  Code,
  isExpectedNullableRpcError,
  isMissingResourceRpcError,
  isRpcError,
  isUnauthenticatedRpcError,
  rpcErrorCode,
  rpcErrorDisposition,
  rpcErrorMentions,
} from "./errors";

/**
 * Stands in for an error that crossed a `"use cache"` boundary: Next.js
 * re-creates it from `name` and `message`, so `code` / `rawMessage` are gone.
 */
const rehydratedConnectError = (message: string): Error => {
  const error = new Error(message);
  error.name = "ConnectError";
  return error;
};

describe("rpcErrorCode", () => {
  it("ConnectError からは code をそのまま読む", () => {
    expect(rpcErrorCode(new ConnectError("gone", Code.NotFound))).toBe(
      Code.NotFound
    );
  });

  it("キャッシュ境界で再生成されたエラーはメッセージ接頭辞から復元する", () => {
    expect(
      rpcErrorCode(rehydratedConnectError("[permission_denied] not published"))
    ).toBe(Code.PermissionDenied);
  });

  it("RPC 由来でないエラーは null", () => {
    expect(rpcErrorCode(new Error("boom"))).toBeNull();
    expect(rpcErrorCode("boom")).toBeNull();
    expect(rpcErrorCode(null)).toBeNull();
  });

  it("メッセージ本文に code 名が含まれるだけでは分類しない", () => {
    expect(rpcErrorCode(new Error("tenant not found"))).toBeNull();
    expect(rpcErrorCode(new Error("failed: not_found"))).toBeNull();
  });

  it("未知の接頭辞は null", () => {
    expect(rpcErrorCode(new Error("[teapot] nope"))).toBeNull();
  });
});

describe("isRpcError", () => {
  it("指定した code のいずれかに一致する", () => {
    const error = new ConnectError("nope", Code.PermissionDenied);
    expect(isRpcError(error, Code.NotFound, Code.PermissionDenied)).toBe(true);
    expect(isRpcError(error, Code.NotFound)).toBe(false);
  });
});

describe("rpcErrorDisposition", () => {
  it.each([
    [Code.NotFound, "not-found"],
    [Code.PermissionDenied, "forbidden"],
    [Code.Unauthenticated, "unauthenticated"],
    [Code.InvalidArgument, "invalid-argument"],
    [Code.OutOfRange, "invalid-argument"],
    [Code.AlreadyExists, "conflict"],
    [Code.Aborted, "conflict"],
    [Code.FailedPrecondition, "precondition"],
    [Code.Unavailable, "unavailable"],
    [Code.Internal, "unexpected"],
  ])("Code %s は %s", (code, expected) => {
    expect(rpcErrorDisposition(new ConnectError("x", code))).toBe(expected);
  });

  it("RPC 由来でないエラーは unexpected", () => {
    expect(rpcErrorDisposition(new TypeError("boom"))).toBe("unexpected");
  });
});

describe("共通ポリシー", () => {
  it("not_found と permission_denied は同じ「見つからない」扱い", () => {
    expect(
      isMissingResourceRpcError(new ConnectError("x", Code.NotFound))
    ).toBe(true);
    expect(
      isMissingResourceRpcError(new ConnectError("x", Code.PermissionDenied))
    ).toBe(true);
    expect(
      isMissingResourceRpcError(new ConnectError("x", Code.Unauthenticated))
    ).toBe(false);
  });

  it("unauthenticated は再認証導線用に切り分ける", () => {
    expect(
      isUnauthenticatedRpcError(new ConnectError("x", Code.Unauthenticated))
    ).toBe(true);
    expect(
      isUnauthenticatedRpcError(new ConnectError("x", Code.PermissionDenied))
    ).toBe(false);
  });

  it("null 許容の読み取りは not_found / permission_denied / unauthenticated のみ", () => {
    expect(
      isExpectedNullableRpcError(new ConnectError("x", Code.Unauthenticated))
    ).toBe(true);
    expect(
      isExpectedNullableRpcError(new ConnectError("x", Code.InvalidArgument))
    ).toBe(false);
    expect(
      isExpectedNullableRpcError(new ConnectError("x", Code.AlreadyExists))
    ).toBe(false);
    expect(isExpectedNullableRpcError(new Error("boom"))).toBe(false);
  });
});

describe("rpcErrorMentions", () => {
  it("ConnectError は code 接頭辞を含まない rawMessage を見る", () => {
    const error = new ConnectError(
      "admin_domain already exists",
      Code.AlreadyExists
    );
    expect(rpcErrorMentions(error, "admin_domain")).toBe(true);
    expect(rpcErrorMentions(error, "already_exists")).toBe(false);
  });

  it("RPC 由来でない値は false", () => {
    expect(rpcErrorMentions("admin_domain", "admin_domain")).toBe(false);
  });
});
