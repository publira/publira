/**
 * The rules the **Tax and invoices** card reads its fields by, the half of
 * `tenant-tax-settings` a Client Component and the Server Action may both
 * import. The Go server applies the same rules and stays the authority; these
 * only spare the operator a round trip.
 */

import { sharePercentToBps } from "./credit-share";

/** The longest legal name the server keeps, in characters. */
export const MAX_INVOICE_LEGAL_NAME_LENGTH = 200;

/** The longest registration number the server keeps, in characters. */
export const MAX_INVOICE_REGISTRATION_NUMBER_LENGTH = 32;

/**
 * A rate typed as a percentage, read into basis points: `null` for an empty
 * field, which sets no rate, and `undefined` for text that is not a rate from
 * 0.01 to 100 with at most two decimal places.
 */
export const ratePercentToBps = (text: string): number | null | undefined => {
  if (text.trim() === "") {
    return null;
  }

  const bps = sharePercentToBps(text);

  return bps === undefined || bps === 0 ? undefined : bps;
};

/** Counts characters as the server does: by code point, not UTF-16 unit. */
const characterCount = (value: string): number => [...value].length;

const CONTROL_CHARACTER_RE = /\p{Cc}/u;

const WHITESPACE_RE = /\s/u;

export type InvoiceLegalNameProblem = "control" | "too_long";

/** Why the server would refuse a trimmed legal name, or `undefined`. */
export const invoiceLegalNameProblem = (
  value: string
): InvoiceLegalNameProblem | undefined => {
  if (characterCount(value) > MAX_INVOICE_LEGAL_NAME_LENGTH) {
    return "too_long";
  }

  return CONTROL_CHARACTER_RE.test(value) ? "control" : undefined;
};

export type InvoiceRegistrationNumberProblem = "too_long" | "whitespace";

/** Why the server would refuse a trimmed registration number, or `undefined`. */
export const invoiceRegistrationNumberProblem = (
  value: string
): InvoiceRegistrationNumberProblem | undefined => {
  if (characterCount(value) > MAX_INVOICE_REGISTRATION_NUMBER_LENGTH) {
    return "too_long";
  }

  return WHITESPACE_RE.test(value) || CONTROL_CHARACTER_RE.test(value)
    ? "whitespace"
    : undefined;
};
