import type { Locale } from "@publira/i18n";
import { currencyFractionDigits, formatPrice } from "@publira/utils";
import { z } from "zod";

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
  amount: number,
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
 * minor unit of `currency`: `500` is `"500"` in JPY and `"5.00"` in USD.
 */
export const toPriceInputValue = (amount: number, currency: string): string => {
  const digits = currencyFractionDigits(currency);

  return (amount / 10 ** digits).toFixed(digits);
};

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
 * A price typed in `currency`, read into the integer of its minor unit the API
 * stores: `"4.99"` in USD is `499`. A blank is `0`, the free price, as it has
 * always been. A value with more decimal places than the currency has is
 * refused rather than rounded, since a rounded price is one the operator did
 * not set, and so is one past what an `int32` holds.
 */
export const priceFormSchema = (
  currency: string,
  message: string
): z.ZodType<number, unknown> => {
  const digits = currencyFractionDigits(currency);

  return z.preprocess(
    (value) => {
      const raw = typeof value === "string" ? value.trim() : "";

      if (raw === "") {
        return 0;
      }

      const match = PRICE_RE.exec(raw);
      const units = match?.groups?.units;
      const fraction = match?.groups?.fraction ?? "";

      if (units === undefined || fraction.length > digits) {
        return;
      }

      return (
        Number(units) * 10 ** digits + Number(fraction.padEnd(digits, "0"))
      );
    },
    z
      .number({ error: message })
      .int(message)
      .min(0, message)
      .max(MAX_INT32, message)
  );
};
