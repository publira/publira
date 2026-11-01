import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as Identifier from "@publira/ui-components/identifier";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatPrice } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SubscriptionPlanBilling } from "#components/subscription-plan-billing";
import { getMessagesFor } from "#lib/messages";
import type { TenantStoreProduct } from "#lib/store-payment-settings";
import type { SubscriptionPlanItem } from "#lib/subscription-plan-shared";

interface StoreProductListProps {
  listErrorMessage?: string;
  locale: Locale;
  products: TenantStoreProduct[];
  /** The plans that name a product in at least one store. */
  subscriptionPlans: SubscriptionPlanItem[];
}

/**
 * The consumable products the tenant creates in both stores: one per price,
 * and one per pack of the tenant's coins, which names the pack it sells. The
 * stores show a product under the name the tenant gives it there, so a list
 * with a pack says the pack's product is to carry the tenant's word for its
 * coins.
 *
 * Below them, each subscription plan that names a store product, with the
 * auto-renewable subscription it is sold as in each store. Such a product is
 * created at the plan's price and period, so the plan's billing stands beside
 * it.
 */
export const StoreProductList = async ({
  listErrorMessage,
  locale,
  products,
  subscriptionPlans,
}: StoreProductListProps) => {
  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.settings.store_products.section_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const t = await getMessagesFor(locale);

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="admin.settings.store_products.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.store_products.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      {products.length === 0 && subscriptionPlans.length === 0 ? (
        <EmptyState.Root>
          <EmptyState.Heading>
            <EmptyState.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message message="admin.settings.store_products.empty_title" />
              </Suspense>
            </EmptyState.Title>
            <EmptyState.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                <Message message="admin.settings.store_products.empty" />
              </Suspense>
            </EmptyState.Description>
          </EmptyState.Heading>
        </EmptyState.Root>
      ) : null}
      {products.length > 0 ? (
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.settings.store_products.product_id" />
                </Suspense>
              </Table.Head>
              <Table.Head className="text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.settings.store_products.price" />
                </Suspense>
              </Table.Head>
              <Table.Head className="text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.settings.store_products.episodes" />
                </Suspense>
              </Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {products.map((product) => (
              <Table.Row key={product.productId}>
                <Table.Cell>
                  <Identifier.Root>
                    <Identifier.Value>{product.productId}</Identifier.Value>
                    <Identifier.Copy
                      aria-label={t(
                        "admin.settings.store_products.copy_product_id"
                      )}
                      value={product.productId}
                    />
                  </Identifier.Root>
                  {product.coinPack ? (
                    <p className="text-sm text-muted-foreground">
                      {t("admin.settings.store_products.coin_pack", {
                        bonus: product.coinPack.bonusCoins,
                        count:
                          product.coinPack.coins + product.coinPack.bonusCoins,
                      })}
                    </p>
                  ) : null}
                </Table.Cell>
                <Table.Cell className="text-right">
                  {formatPrice(product.price, {
                    currency: product.currency,
                    locale,
                  })}
                </Table.Cell>
                <Table.Cell className="text-right">
                  {product.coinPack ? null : product.episodeCount}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      ) : null}
      {products.some((product) => product.coinPack) ? (
        <p className="text-sm text-muted-foreground">
          {t("admin.settings.store_products.coin_pack_names")}
        </p>
      ) : null}
      {subscriptionPlans.length > 0 ? (
        <div className="grid gap-3">
          <div className="grid gap-1">
            <h3 className="text-sm font-medium text-foreground">
              <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
                <Message message="admin.settings.store_products.subscriptions_title" />
              </Suspense>
            </h3>
            <p className="text-sm text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.settings.store_products.subscriptions_description" />
              </Suspense>
            </p>
          </div>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.settings.store_products.plan" />
                  </Suspense>
                </Table.Head>
                <Table.Head>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.settings.store_products.app_store" />
                  </Suspense>
                </Table.Head>
                <Table.Head>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.settings.store_products.google_play" />
                  </Suspense>
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {subscriptionPlans.map((plan) => (
                <Table.Row key={plan.id}>
                  <Table.Cell>
                    <p className="font-medium">{plan.name}</p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      <SubscriptionPlanBilling locale={locale} plan={plan} />
                    </p>
                  </Table.Cell>
                  <Table.Cell>
                    {plan.appStoreProductId ? (
                      <Identifier.Root>
                        <Identifier.Value>
                          {plan.appStoreProductId}
                        </Identifier.Value>
                        <Identifier.Copy
                          aria-label={t(
                            "admin.settings.store_products.copy_product_id"
                          )}
                          value={plan.appStoreProductId}
                        />
                      </Identifier.Root>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {t("admin.settings.store_products.not_sold")}
                      </span>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {plan.googlePlayProductId ? (
                      <Identifier.Root>
                        <Identifier.Value>
                          {plan.googlePlayProductId}
                        </Identifier.Value>
                        <Identifier.Copy
                          aria-label={t(
                            "admin.settings.store_products.copy_product_id"
                          )}
                          value={plan.googlePlayProductId}
                        />
                      </Identifier.Root>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {t("admin.settings.store_products.not_sold")}
                      </span>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </div>
      ) : null}
    </ConsoleSection.Root>
  );
};
