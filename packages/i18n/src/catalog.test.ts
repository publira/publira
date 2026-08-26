import { describe, expect, it } from "vitest";

import enCatalog from "../../../locales/en.json" with { type: "json" };
import jaCatalog from "../../../locales/ja.json" with { type: "json" };
import { sharedCatalog, sharedMessage, sharedRpcErrorMessage } from "./catalog";
import type { ExactCatalog } from "./i18n";

/** Compile-time: root `en.json` must match `ja.json` with no extra keys. */
const enMatchesJa: ExactCatalog<typeof enCatalog, typeof jaCatalog> = enCatalog;

describe("sharedCatalog", () => {
  it("returns the ja catalog by default", () => {
    expect(sharedCatalog()).toBe(jaCatalog);
    expect(sharedCatalog("ja")).toBe(jaCatalog);
  });

  it("returns the en catalog when asked", () => {
    expect(enMatchesJa).toBe(enCatalog);
    expect(sharedCatalog("en")).toBe(enCatalog);
  });

  it("falls back to ja for an unknown locale string", () => {
    expect(sharedCatalog("fr")).toBe(jaCatalog);
  });
});

describe("sharedMessage", () => {
  it("reads a shared key in the default locale", () => {
    expect(sharedMessage("errors.validation")).toBe(
      "入力内容を確認してください。"
    );
    expect(sharedMessage("errors.disallowed_value")).toBe(
      "許可されていない値です。"
    );
  });

  it("reads the same key in English", () => {
    expect(sharedMessage("errors.validation", "en")).toBe(
      "Please check the information you entered."
    );
    expect(sharedMessage("errors.disallowed_value", "en")).toBe(
      "This value is not allowed."
    );
  });
});

describe("sharedRpcErrorMessage", () => {
  it("returns the Japanese wording when locale is omitted", () => {
    expect(sharedRpcErrorMessage("unauthenticated")).toBe(
      "セッションが無効です。再ログインしてください。"
    );
    expect(sharedRpcErrorMessage("forbidden")).toBe(
      "この操作を行う権限がありません。"
    );
    expect(sharedRpcErrorMessage("invalid-argument")).toBe(
      "入力内容に誤りがあります。"
    );
    expect(sharedRpcErrorMessage("not-found")).toBe("対象が見つかりません。");
    expect(sharedRpcErrorMessage("conflict")).toBe(
      "重複するデータがあるため保存できません。"
    );
    expect(sharedRpcErrorMessage("unavailable")).toBe(
      "サーバーに接続できませんでした。時間をおいて再試行してください。"
    );
  });

  it("returns the English wording when locale is en", () => {
    expect(sharedRpcErrorMessage("unauthenticated", "en")).toBe(
      "Your session is no longer valid. Please sign in again."
    );
    expect(sharedRpcErrorMessage("forbidden", "en")).toBe(
      "You do not have permission to perform this action."
    );
    expect(sharedRpcErrorMessage("invalid-argument", "en")).toBe(
      "The submitted values are invalid."
    );
    expect(sharedRpcErrorMessage("not-found", "en")).toBe(
      "The requested item could not be found."
    );
    expect(sharedRpcErrorMessage("conflict", "en")).toBe(
      "Cannot save because this data already exists."
    );
    expect(sharedRpcErrorMessage("unavailable", "en")).toBe(
      "Could not connect to the server. Please try again later."
    );
  });

  it("returns undefined for categories that have no shared copy", () => {
    expect(sharedRpcErrorMessage("precondition")).toBeUndefined();
    expect(sharedRpcErrorMessage("unexpected")).toBeUndefined();
    expect(sharedRpcErrorMessage("precondition", "en")).toBeUndefined();
  });
});
