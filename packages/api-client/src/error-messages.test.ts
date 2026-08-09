import { ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { rpcErrorMessage } from "./error-messages";
import { Code } from "./errors";

const fallback = "保存に失敗しました。時間をおいて再試行してください。";

describe("rpcErrorMessage", () => {
  it("分類に対応する共通文言を返す", () => {
    expect(
      rpcErrorMessage(new ConnectError("x", Code.Unauthenticated), fallback)
    ).toBe("セッションが無効です。再ログインしてください。");
    expect(
      rpcErrorMessage(new ConnectError("x", Code.PermissionDenied), fallback)
    ).toBe("この操作を行う権限がありません。");
    expect(
      rpcErrorMessage(new ConnectError("x", Code.InvalidArgument), fallback)
    ).toBe("入力内容に誤りがあります。");
  });

  it("共通文言の無い分類は fallback を返す", () => {
    expect(
      rpcErrorMessage(new ConnectError("x", Code.FailedPrecondition), fallback)
    ).toBe(fallback);
    expect(rpcErrorMessage(new Error("boom"), fallback)).toBe(fallback);
  });

  it("overrides は共通文言より優先する", () => {
    expect(
      rpcErrorMessage(new ConnectError("x", Code.NotFound), fallback, {
        "not-found": "指定したエピソードが見つかりません。",
      })
    ).toBe("指定したエピソードが見つかりません。");
  });
});
