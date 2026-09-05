import { ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { rpcErrorMessage, smtpTestFailureMessage } from "./error-messages";
import { Code } from "./errors";

const fallback = "Could not save. Please try again later.";

describe("rpcErrorMessage", () => {
  it("returns the shared message for a mapped category", () => {
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

  it("ja renders the same categories in Japanese", () => {
    expect(
      rpcErrorMessage(new ConnectError("x", Code.Unauthenticated), fallback, {
        locale: "ja",
      })
    ).toBe("セッションが無効です。再ログインしてください。");
    expect(
      rpcErrorMessage(new ConnectError("x", Code.PermissionDenied), fallback, {
        locale: "ja",
      })
    ).toBe("この操作を行う権限がありません。");
    expect(
      rpcErrorMessage(new ConnectError("x", Code.InvalidArgument), fallback, {
        locale: "ja",
      })
    ).toBe("入力内容に誤りがあります。");
  });

  it("a category without a shared message returns the fallback", () => {
    expect(
      rpcErrorMessage(
        new ConnectError("x", Code.FailedPrecondition),
        fallback,
        { locale: "ja" }
      )
    ).toBe(fallback);
    expect(
      rpcErrorMessage(
        new ConnectError("x", Code.FailedPrecondition),
        fallback,
        { locale: "en" }
      )
    ).toBe(fallback);
    expect(rpcErrorMessage(new Error("boom"), fallback, { locale: "ja" })).toBe(
      fallback
    );
  });

  it("overrides take precedence over the shared message", () => {
    expect(
      rpcErrorMessage(new ConnectError("x", Code.NotFound), fallback, {
        locale: "en",
        overrides: {
          "not-found": "That episode could not be found.",
        },
      })
    ).toBe("That episode could not be found.");
  });
});

describe("smtpTestFailureMessage", () => {
  it("renders the same failure reason in each locale", () => {
    expect(smtpTestFailureMessage("SMTP_TEST_AUTHENTICATION", "en")).toBe(
      "SMTP authentication failed."
    );
    expect(smtpTestFailureMessage("SMTP_TEST_AUTHENTICATION", "ja")).toBe(
      "SMTP 認証に失敗しました"
    );
  });
});
