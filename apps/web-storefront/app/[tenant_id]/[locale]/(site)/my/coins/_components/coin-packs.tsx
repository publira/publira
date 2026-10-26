import type { Locale } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatPrice } from "@publira/utils";
import { Suspense } from "react";

import { CoinDisclosures } from "#components/coin-disclosures";
import { CoinPackCheckoutForm } from "#components/coin-pack-checkout-form";
import { Message } from "#components/message";
import { coinPackTotal } from "#lib/coins";
import type { CoinSettingsItem } from "#lib/coins";

/**
 * The packs the tenant sells, each with what it grants, what it costs, how
 * long its coins can be spent, and the control that starts its checkout, and
 * under them what the tenant discloses about its coins.
 *
 * A tenant that stopped selling packs still lets readers spend what they hold,
 * which is what the section says instead. A site that takes no payments
 * cannot sell a pack either, since a pack is sold through its payment
 * provider.
 */
export const CoinPacks = ({
  acceptsPayments,
  locale,
  settings,
  tenantId,
}: {
  acceptsPayments: boolean;
  locale: Locale;
  settings: CoinSettingsItem;
  tenantId: string;
}) => {
  const { coinName, disclosures, expiryDays, packs } = settings;

  if (packs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
          <Message
            message="storefront.coins.packs_not_selling"
            values={{ coin_name: coinName }}
          />
        </Suspense>
      </p>
    );
  }

  return (
    <div className="grid gap-6">
      {acceptsPayments ? null : (
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="storefront.coins.packs_payments_unavailable" />
          </Suspense>
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {packs.map((pack) => {
          const price = formatPrice(pack.price, {
            currency: pack.currency,
            locale,
          });
          return (
            <li
              className="grid content-between gap-4 border border-border bg-background p-4"
              key={pack.id}
            >
              <div className="grid gap-1">
                <h3 className="font-serif text-lg leading-tight tabular-nums">
                  <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
                    <Message
                      message="storefront.coins.pack_title"
                      values={{
                        bonus: pack.bonusCoins,
                        coin_name: coinName,
                        count: coinPackTotal(pack),
                      }}
                    />
                  </Suspense>
                </h3>
                <p className="tabular-nums">{price}</p>
                <p className="text-sm text-muted-foreground">
                  <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                    <Message
                      message="storefront.coins.pack_expiry"
                      values={{ coin_name: coinName, days: expiryDays }}
                    />
                  </Suspense>
                </p>
              </div>
              {acceptsPayments ? (
                <CoinPackCheckoutForm
                  coinPackId={pack.id}
                  tenantId={tenantId}
                  variant="outline"
                >
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message
                      message="storefront.coins.pack_buy"
                      values={{ price }}
                    />
                  </Suspense>
                </CoinPackCheckoutForm>
              ) : null}
            </li>
          );
        })}
      </ul>
      <CoinDisclosures disclosures={disclosures} />
    </div>
  );
};
