import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { formatPrice } from "@publira/utils";

import type { StorefrontMessageAccessor } from "#lib/messages";
import type { PurchaseItem } from "#lib/purchases";
import type { TenantInvoice } from "#lib/tenant";

/**
 * Who a taxed purchase was charged by, as the tenant names itself now: the
 * receipt names it the same way.
 */
export type PurchaseIssuer = Pick<
  TenantInvoice,
  "legalName" | "registrationNumber"
>;

/** A tax rate as the console writes it: `10%`, `8%`, `7.5%`. */
const formatTaxRate = (bps: number, locale: Locale): string =>
  new Intl.NumberFormat(toIntlLocale(locale), {
    maximumFractionDigits: 2,
    style: "percent",
  }).format(bps / 10_000);

/**
 * The tax a purchase includes, and the name and registration number it was
 * charged under, which is what a reader keeping the purchase as an invoice
 * needs. A purchase that was charged no tax states none of it, and a name or
 * a number the tenant has not entered is left out. A purchase the App Store or
 * Google Play charged states its tax alone: the store issued its receipt, so
 * the tenant's name and number are not what it was charged under.
 */
export const PurchaseTax = ({
  issuer,
  locale,
  purchase,
  t,
}: {
  issuer: PurchaseIssuer;
  locale: Locale;
  purchase: PurchaseItem;
  t: StorefrontMessageAccessor;
}) => {
  if (!purchase.tax) {
    return null;
  }

  const issuedByTenant = !purchase.chargedByStore;

  return (
    <>
      <div>
        <dt>{t("storefront.library.tax_label")}</dt>
        <dd className="mt-1 text-foreground tabular-nums">
          {t("storefront.library.tax_value", {
            amount: formatPrice(purchase.tax.amount, {
              currency: purchase.currency,
              locale,
            }),
            rate: formatTaxRate(purchase.tax.rateBps, locale),
          })}
        </dd>
      </div>
      {issuedByTenant && issuer.legalName ? (
        <div>
          <dt>{t("storefront.library.issuer")}</dt>
          <dd className="mt-1 text-foreground">{issuer.legalName}</dd>
        </div>
      ) : null}
      {issuedByTenant && issuer.registrationNumber ? (
        <div>
          <dt>{t("storefront.library.registration_number")}</dt>
          <dd className="mt-1 text-foreground tabular-nums">
            {issuer.registrationNumber}
          </dd>
        </div>
      ) : null}
    </>
  );
};
