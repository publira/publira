import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { getMessagesFor } from "./messages";
import { priceFormSchema } from "./price";
import { getTenantCurrency } from "./public-api";

/**
 * A raw form value that a price schema reads once the currency is known, so a
 * form schema can take the field before the Action has resolved the tenant.
 */
export const rawPriceFormSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : ""),
  z.string()
);

export type TenantPriceResult =
  /**
   * `currency` is the one the price was read in, which the write sends along
   * for the API to check it against the tenant's again.
   */
  | { ok: true; value: number; currency: string }
  | { ok: false; message: string };

/**
 * A price an Action took for `tenantId`, read in the currency the tenant sells
 * in as the API answers it now, never one the form claims. Without that
 * currency no price can be read, and the Action says so instead of storing a
 * number in a currency nobody chose.
 *
 * `formCurrency` is the currency the form showed the price in. A form opened
 * before the tenant's currency changed was typed in the old one, and reading
 * its number in the new one would store a price the operator never set, so it
 * is refused until the page is reloaded.
 */
export const parseTenantPrice = async (
  raw: string,
  formCurrency: string,
  tenantId: string,
  locale: Locale
): Promise<TenantPriceResult> => {
  const [t, currency] = await Promise.all([
    getMessagesFor(locale),
    getTenantCurrency(tenantId),
  ]);
  if (!currency) {
    return {
      message: t("admin.series.episodes.currency_unavailable"),
      ok: false,
    };
  }
  if (formCurrency !== currency) {
    return {
      message: t("admin.series.episodes.currency_changed"),
      ok: false,
    };
  }
  const parsed = priceFormSchema(
    currency,
    t("admin.series.episodes.validation.price_invalid")
  ).safeParse(raw);
  return parsed.success
    ? { currency, ok: true, value: parsed.data }
    : {
        message: t("admin.series.episodes.validation.price_invalid"),
        ok: false,
      };
};
