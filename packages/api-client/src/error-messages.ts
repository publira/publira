import type { RpcErrorDisposition } from "./errors.js";
import { rpcErrorDisposition } from "./errors.js";

/**
 * The message every app shows for a given RPC failure category.
 *
 * Shared rather than per-app on purpose: the same RPC error has to read the
 * same way in `web-host`, `web-admin`, and `web-platform` (#645). A screen that
 * needs different wording passes an override for that one category instead of
 * re-deriving the category itself.
 *
 * `precondition` and `unexpected` have no entry — what a failed precondition
 * means is specific to the operation ("この招待は再送できない状態です。"), and
 * `unexpected` is by definition unclassified. Both fall back to the caller's
 * operation-specific message.
 */
const SHARED_MESSAGES: Partial<Record<RpcErrorDisposition, string>> = {
  conflict: "重複するデータがあるため保存できません。",
  forbidden: "この操作を行う権限がありません。",
  "invalid-argument": "入力内容に誤りがあります。",
  "not-found": "対象が見つかりません。",
  unauthenticated: "セッションが無効です。再ログインしてください。",
  unavailable:
    "サーバーに接続できませんでした。時間をおいて再試行してください。",
};

/**
 * Japanese copy for a caught RPC error.
 *
 * `fallback` is the operation-specific message ("著者の保存に失敗しました。…")
 * used when the category has no shared wording. `overrides` replaces the shared
 * wording for individual categories.
 */
export const rpcErrorMessage = (
  error: unknown,
  fallback: string,
  overrides?: Partial<Record<RpcErrorDisposition, string>>
): string => {
  const disposition = rpcErrorDisposition(error);
  return overrides?.[disposition] ?? SHARED_MESSAGES[disposition] ?? fallback;
};
