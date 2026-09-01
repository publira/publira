/**
 * `safeParse` failure → the shape a Server Action's state object needs.
 *
 * Every app models a rejected submission as "one message for the form, plus at
 * most one message per field", so the flattened zod error is reshaped once here
 * instead of each action writing `flatten().fieldErrors[field]?.[0]` by hand.
 *
 * ```ts
 * const parsed = schema.safeParse(input);
 * if (!parsed.success) {
 *   return {
 *     fieldErrors: toFieldErrors(parsed.error),
 *     message: validationErrorMessage(locale),
 *     ok: false,
 *   };
 * }
 * ```
 *
 * Only top-level fields are reported, which is the shape of a form schema.
 */

import type { Locale } from "@publira/i18n";
import { sharedMessage } from "@publira/i18n/catalog";
import { z } from "zod";

/** Shared wording so a rejected form reads the same in all three apps. */
export const validationErrorMessage = (locale: Locale): string =>
  sharedMessage("errors.validation", locale);

/** At most one message per schema field, ready to hand to the form controls. */
export type FieldErrors<T> = {
  [K in keyof T]?: string;
};

export interface FormErrorMessageOptions {
  /** Used when the error carries no message at all. Default: {@link validationErrorMessage} for `locale`. */
  fallback?: string;
  /** UI locale the rejection is worded in. */
  locale: Locale;
}

/**
 * First message per field. Later issues on the same field are dropped: a form
 * control shows one message, and the first one is the one that made the value
 * invalid.
 */
export const toFieldErrors = <T>(error: z.ZodError<T>): FieldErrors<T> => {
  const { fieldErrors } = z.flattenError(error);
  const result: Record<string, string> = {};

  for (const [field, messages] of Object.entries(fieldErrors)) {
    const message = (messages as string[] | undefined)?.[0];
    if (message) {
      result[field] = message;
    }
  }

  return result as FieldErrors<T>;
};

/**
 * Single message for an Action state that has no per-field slot. A form-level
 * issue (a cross-field rule, e.g. "end must be after start") wins over a field
 * issue, since no control would ever display it.
 */
export const toFormErrorMessage = <T>(
  error: z.ZodError<T>,
  options: FormErrorMessageOptions
): string => {
  const { fieldErrors, formErrors } = z.flattenError(error);
  const [formError] = formErrors;
  if (formError) {
    return formError;
  }

  for (const messages of Object.values(fieldErrors)) {
    const message = (messages as string[] | undefined)?.[0];
    if (message) {
      return message;
    }
  }

  return options.fallback ?? validationErrorMessage(options.locale);
};
