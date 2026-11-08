import type { Locale } from "@publira/i18n";
import {
  currencyFractionDigits,
  formatPrice,
  toMajorUnitDecimal,
} from "@publira/utils";
import { z } from "zod";

import { isFormText } from "./form-schemas";
import { MAX_INT32 } from "./int32";

/**
 * A price the way an operator types it: whole units, and a fraction after a
 * point. Signs and exponents are not prices.
 */
const PRICE_RE = /^(?<units>\d+)(?:\.(?<fraction>\d*))?$/u;

/** An ISO 4217 code as the API spells it. */
const CURRENCY_RE = /^[A-Z]{3}$/u;

/**
 * The currency code the API answered, or `null` for anything that is not one,
 * such as the empty string of a server that predates the field.
 */
export const readCurrency = (value: string | undefined): string | null =>
  value !== undefined && CURRENCY_RE.test(value) ? value : null;

/**
 * An amount the API sends, formatted in the tenant's currency, or a dash while
 * that currency could not be read: a number in no currency is no amount.
 */
export const formatTenantAmount = (
  amount: bigint | number,
  options: { currency: string | null; locale: Locale }
): string =>
  options.currency
    ? formatPrice(amount, {
        currency: options.currency,
        locale: options.locale,
      })
    : "-";

/**
 * The value a price input shows for an amount the API sends, an integer in the
 * minor unit of `currency`: `500` is `"500"` in JPY and `"5.00"` in USD. An
 * `int64` amount arrives as `bigint` and an `int32` one as `number`.
 */
export const toPriceInputValue = (
  amount: bigint | number,
  currency: string
): string => toMajorUnitDecimal(BigInt(amount), currency);

/**
 * The `step` of a price input in `currency`: one of its minor unit, so the
 * browser offers no more decimal places than the currency has.
 */
export const priceInputStep = (currency: string): string => {
  const digits = currencyFractionDigits(currency);

  return (1 / 10 ** digits).toFixed(digits);
};

/**
 * The largest price an input in `currency` takes: what the API's `int32`
 * holds, written in the currency itself.
 */
export const maxPriceInputValue = (currency: string): string =>
  toPriceInputValue(MAX_INT32, currency);

/**
 * An amount typed in `currency`, read into the integer of its minor unit the
 * API sends as an `int64`: `"4.99"` in USD is `499n`. `null` for anything that
 * is not an amount, including a value with more decimal places than the
 * currency has, which is refused rather than rounded since a rounded amount is
 * one nobody typed. The caller decides what a blank means.
 */
export const parseAmountInput = (
  value: string,
  currency: string
): bigint | null => {
  const digits = currencyFractionDigits(currency);
  const match = PRICE_RE.exec(value.trim());
  const units = match?.groups?.units;
  const fraction = match?.groups?.fraction ?? "";

  if (units === undefined || fraction.length > digits) {
    return null;
  }

  return (
    BigInt(units) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0"))
  );
};

/**
 * {@link parseAmountInput} for a price the API carries as an `int32`, which
 * the caller still holds to {@link MAX_INT32}.
 */
export const parsePriceInput = (
  value: string,
  currency: string
): number | null => {
  const amount = parseAmountInput(value, currency);

  return amount === null ? null : Number(amount);
};

/**
 * A price typed in `currency`, read by {@link parsePriceInput} into the
 * integer of its minor unit the API stores. A blank is `0`, the free price, as
 * it has always been, and a price past what an `int32` holds is refused.
 */
export const priceFormSchema = (
  currency: string,
  message: string
): z.ZodType<number, unknown> =>
  z.preprocess(
    (value) => {
      const raw = isFormText(value) ? value.trim() : "";

      if (raw === "") {
        return 0;
      }

      return parsePriceInput(raw, currency) ?? undefined;
    },
    z
      .number({ error: message })
      .int(message)
      .min(0, message)
      .max(MAX_INT32, message)
  );
