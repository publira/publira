/**
 * Shared zod schemas for web-admin's untrusted auth input.
 *
 * `searchParams` go through `@publira/utils/search-params` so a missing,
 * conflicting, or over-long query never reaches the page as a raw
 * `string | string[]`. Form fields go through `@publira/utils/form-data` at
 * the call site; the schemas here describe what those fields may contain.
 *
 * `next` is sanitized here (not after a successful parse) so every
 * consumer — login query, login form, error-redirect builder — shares one
 * open-redirect rule.
 */

import { searchParamString } from "@publira/utils/search-params";
import { z } from "zod";

import { sanitizeRedirectPath } from "./admin-auth-shared";
import { isTenantIdFormat } from "./tenant-id-format";

/** Paths in `next` can carry a query string; 255 would clip real ones. */
const NEXT_PATH_MAX_LENGTH = 2048;

/** 32-byte token encoded as hex (`server/api/adminapi/auth_handlers.go`). */
const AUTH_TOKEN_PATTERN = /^[0-9a-fA-F]{64}$/u;

export const nextPathSearchParamSchema = searchParamString({
  fallback: "/",
  maxLength: NEXT_PATH_MAX_LENGTH,
}).transform((value) => sanitizeRedirectPath(value));

/**
 * Hidden form field. Missing, over-long, or non-string values become the same
 * "/" default as the query schema — without `ZodCatch`, which lint reads as
 * `Promise.catch`.
 */
export const nextPathFormSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return "/";
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > NEXT_PATH_MAX_LENGTH) {
    return "/";
  }

  return sanitizeRedirectPath(trimmed);
}, z.string());

/** Flash / error query shown on a page. Invalid values hide the message. */
export const errorSearchParamSchema = searchParamString({ fallback: "" });

/**
 * Invite / password-reset / email-change token. Anything that is not the
 * 64-char hex the server issues is treated as "no token" so the page can
 * show the existing invalid-link copy instead of forwarding garbage to the
 * RPC.
 */
export const authTokenSearchParamSchema = searchParamString({
  fallback: "",
  maxLength: 64,
}).transform((value) => (AUTH_TOKEN_PATTERN.test(value) ? value : ""));

export const authTokenFormSchema = z
  .string()
  .trim()
  .refine((value) => AUTH_TOKEN_PATTERN.test(value), {
    error: "確認リンクが無効です。",
  });

export const inviteTokenFormSchema = z
  .string({ error: "招待トークンが見つかりません。" })
  .trim()
  .refine((value) => AUTH_TOKEN_PATTERN.test(value), {
    error: "招待トークンが見つかりません。",
  });

/**
 * Email shown on a login / reset screen. Not an input we act on as a
 * destination, so a malformed value is dropped rather than 404ing the page.
 */
export const emailSearchParamSchema = searchParamString({
  fallback: "",
  maxLength: 255,
}).transform((value) => (z.email().safeParse(value).success ? value : ""));

export const tenantIdFormSchema = z
  .string({ error: "テナント ID が見つかりません。" })
  .trim()
  .min(1, "テナント ID が見つかりません。")
  .refine(isTenantIdFormat, { error: "テナント ID が見つかりません。" });

export const emailFormSchema = z
  .string({ error: "メールアドレスを入力してください。" })
  .trim()
  .min(1, "メールアドレスを入力してください。")
  .pipe(z.email("メールアドレスの形式が正しくありません。"));

export const passwordFormSchema = z
  .string({ error: "パスワードを入力してください。" })
  .min(1, "パスワードを入力してください。")
  .max(1024);
