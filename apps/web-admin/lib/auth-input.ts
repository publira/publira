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

import type { Locale } from "@publira/i18n";
import { searchParamString } from "@publira/utils/search-params";
import { z } from "zod";

import { sanitizeRedirectPath } from "./admin-auth-shared";
import { getMessagesFor } from "./messages";
import { isTenantIdFormat } from "./tenant-id-format";

/** Paths in `next` can carry a query string; 255 would clip real ones. */
const NEXT_PATH_MAX_LENGTH = 2048;

/** `passkeyNameMaxLength` in `server/api/adminapi/passkey_handlers.go`. */
const PASSKEY_NAME_MAX_LENGTH = 64;

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

export const authTokenFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .string()
    .trim()
    .refine((value) => AUTH_TOKEN_PATTERN.test(value), {
      error: t("admin.auth.fields.invalid_token"),
    });
};

export const inviteTokenFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .string({
      error: t("admin.auth.accept_invite.invalid_token"),
    })
    .trim()
    .refine((value) => AUTH_TOKEN_PATTERN.test(value), {
      error: t("admin.auth.accept_invite.invalid_token"),
    });
};

/**
 * Email shown on a login / reset screen. Not an input we act on as a
 * destination, so a malformed value is dropped rather than 404ing the page.
 */
export const emailSearchParamSchema = searchParamString({
  fallback: "",
  maxLength: 255,
}).transform((value) => (z.email().safeParse(value).success ? value : ""));

export const tenantIdFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const missing = t("admin.auth.fields.tenant_missing");

  return z
    .string({ error: missing })
    .trim()
    .min(1, missing)
    .refine(isTenantIdFormat, { error: missing });
};

export const emailFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const required = t("admin.auth.fields.email_required");

  return z
    .string({ error: required })
    .trim()
    .min(1, required)
    .pipe(z.email(t("admin.auth.fields.email_invalid")));
};

/**
 * A code from an authenticator app or one of the account's recovery codes.
 *
 * Only the length is checked here. Which of the two shapes is acceptable
 * depends on the RPC, and only the API can say whether a code is the right
 * one — a client-side format rule would just turn a refusal into a different
 * refusal.
 */
export const mfaCodeFormSchema = z.string().trim().min(1).max(64);

/**
 * The `PublicKeyCredential` a passkey ceremony produced, as its `toJSON()`
 * serialized it. Only its presence and size are checked here: the API parses
 * and verifies it against the ceremony it began. An attestation with a
 * certificate chain runs to a few kilobytes, so the bound only stops a body
 * no authenticator writes.
 */
export const passkeyCredentialFormSchema = z
  .string()
  .trim()
  .min(1)
  .max(64 * 1024);

/**
 * What a member of staff calls one of their passkeys. An empty field leaves
 * it unnamed, but a missing field or a file is refused rather than read as
 * empty: renaming with an empty name clears the one the passkey has. The API
 * bounds it in characters rather than UTF-16 units, so the length is counted
 * the same way here.
 */
export const passkeyNameFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .string({ error: t("admin.settings.mfa.passkey_rename_failed") })
    .trim()
    .refine((value) => [...value].length <= PASSKEY_NAME_MAX_LENGTH, {
      error: t("admin.settings.mfa.passkey_name_too_long"),
    });
};

export const passwordFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const required = t("admin.auth.fields.password_required");

  return z.string({ error: required }).min(1, required).max(1024);
};
