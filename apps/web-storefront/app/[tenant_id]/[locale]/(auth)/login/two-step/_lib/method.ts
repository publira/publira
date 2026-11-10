import type { SearchParamValue } from "@publira/utils/search-params";
import { searchParamEnum } from "@publira/utils/search-params";

/**
 * What the code step asks for: a code from the authenticator app, or one of
 * the recovery codes for a reader without it. The API takes either from the
 * same field; the method only decides the wording and the keyboard.
 */
export const MFA_METHODS = ["authenticator", "recovery"] as const;

export type MfaMethod = (typeof MFA_METHODS)[number];

/** The query parameter that switches the code step to a recovery code. */
export const MFA_METHOD_PARAM = "method";

const methodSearchParamSchema = searchParamEnum(MFA_METHODS, {
  fallback: "authenticator",
});

export const parseMfaMethod = (value: SearchParamValue): MfaMethod =>
  methodSearchParamSchema.parse(value);
