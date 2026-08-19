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

  it("locale を渡すと共有カテゴリがその言語になる", () => {
    expect(
      rpcErrorMessage(new ConnectError("x", Code.Unauthenticated), fallback, {
        locale: "en",
      })
    ).toBe("Your session is no longer valid. Please sign in again.");
    expect(
      rpcErrorMessage(new ConnectError("x", Code.PermissionDenied), fallback, {
        locale: "en",
      })
    ).toBe("You do not have permission to perform this action.");
    expect(
      rpcErrorMessage(new ConnectError("x", Code.InvalidArgument), fallback, {
        locale: "en",
      })
    ).toBe("The submitted values are invalid.");
    expect(
      rpcErrorMessage(new ConnectError("x", Code.NotFound), fallback, {
        locale: "en",
      })
    ).toBe("The requested item could not be found.");
    expect(
      rpcErrorMessage(new ConnectError("x", Code.AlreadyExists), fallback, {
        locale: "en",
      })
    ).toBe("Cannot save because this data already exists.");
    expect(
      rpcErrorMessage(new ConnectError("x", Code.Unavailable), fallback, {
        locale: "en",
      })
    ).toBe("Could not connect to the server. Please try again later.");
  });

  it("未知の locale は日本語に落ちる", () => {
    expect(
      rpcErrorMessage(new ConnectError("x", Code.Unauthenticated), fallback, {
        locale: "fr",
      })
    ).toBe("セッションが無効です。再ログインしてください。");
  });

  it("共通文言の無い分類は fallback を返す", () => {
    expect(
      rpcErrorMessage(new ConnectError("x", Code.FailedPrecondition), fallback)
    ).toBe(fallback);
    expect(
      rpcErrorMessage(
        new ConnectError("x", Code.FailedPrecondition),
        fallback,
        { locale: "en" }
      )
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

  it("options.overrides は locale より優先する", () => {
    expect(
      rpcErrorMessage(new ConnectError("x", Code.NotFound), fallback, {
        locale: "en",
        overrides: {
          "not-found": "指定したエピソードが見つかりません。",
        },
      })
    ).toBe("指定したエピソードが見つかりません。");
  });
});
