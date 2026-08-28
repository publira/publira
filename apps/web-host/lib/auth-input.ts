/**
 * Shared zod schemas for web-host's untrusted auth / settings input.
 *
 * `searchParams` go through `@publira/utils/search-params` so a missing,
 * conflicting, or over-long query never reaches the page as a raw
 * `string | string[]`. Form fields go through `@publira/utils/form-data` at
 * the call site; the schemas here describe what those fields may contain.
 *
 * `returnTo` is sanitized here (not after a successful parse) so every
 * consumer — login query, login form, error-redirect builder — shares one
 * open-redirect rule.
 *
 * A schema whose rejection reaches the reader is a function of the catalog
 * rather than a module constant: the wording depends on the request's locale,
 * which only a Server Action or a suspended section can resolve.
 */

import { getMessage } from "@publira/i18n";
import { searchParamString } from "@publira/utils/search-params";
import { z } from "zod";

import { sanitizeRedirectPath } from "./auth-shared";
import type { HostMessages } from "./messages";
import { isTenantIdFormat } from "./tenant-id-format";

/** Paths in `returnTo` can carry a query string; 255 would clip real ones. */
const RETURN_TO_MAX_LENGTH = 2048;

/** 32-byte token encoded as hex (`server/api/publicapi/auth_handlers.go`). */
const AUTH_TOKEN_PATTERN = /^[0-9a-fA-F]{64}$/u;

export const returnToSearchParamSchema = searchParamString({
  fallback: "/",
  maxLength: RETURN_TO_MAX_LENGTH,
}).transform((value) => sanitizeRedirectPath(value));

/**
 * Hidden form field. Missing, over-long, or non-string values become the same
 * "/" default as the query schema — without `ZodCatch`, which lint reads as
 * `Promise.catch`.
 */
export const returnToFormSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return "/";
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > RETURN_TO_MAX_LENGTH) {
    return "/";
  }

  return sanitizeRedirectPath(trimmed);
}, z.string());

/** Flash / error query shown on a page. Invalid values hide the message. */
export const errorSearchParamSchema = searchParamString({ fallback: "" });

/**
 * Email confirmation / password-reset token. Anything that is not the 64-char
 * hex the server issues is treated as "no token" so the page can show the
 * existing invalid-link copy instead of forwarding garbage to the RPC.
 */
export const authTokenSearchParamSchema = searchParamString({
  fallback: "",
  maxLength: 64,
}).transform((value) => (AUTH_TOKEN_PATTERN.test(value) ? value : ""));

/**
 * The tenant id as a shape check, with no reader-facing wording.
 *
 * `tenant_id` is written by `proxy.ts` and carried in a hidden field, so a
 * rejected value means the request never came through the site. Callers that
 * answer such a request without showing a message — a Route Handler, an Action
 * that returns early or words the whole rejection itself — use this one and
 * stay free of the catalog.
 */
export const tenantIdSchema = z.string().trim().refine(isTenantIdFormat);

export const authTokenFormSchema = (messages: HostMessages) =>
  z
    .string()
    .trim()
    .refine((value) => AUTH_TOKEN_PATTERN.test(value), {
      error: getMessage(messages, "host.auth.fields.invalid_token"),
    });

export const tenantIdFormSchema = (messages: HostMessages) => {
  const missing = getMessage(messages, "host.auth.fields.tenant_missing");

  return z
    .string({ error: missing })
    .trim()
    .refine(isTenantIdFormat, { error: missing });
};

export const emailFormSchema = (messages: HostMessages) => {
  const required = getMessage(messages, "host.auth.fields.email_required");

  return z
    .string({ error: required })
    .trim()
    .min(1, required)
    .pipe(z.email(getMessage(messages, "host.auth.fields.email_invalid")));
};

export const passwordFormSchema = (messages: HostMessages) => {
  const required = getMessage(messages, "host.auth.fields.password_required");

  return z.string({ error: required }).min(1, required).max(1024);
};
