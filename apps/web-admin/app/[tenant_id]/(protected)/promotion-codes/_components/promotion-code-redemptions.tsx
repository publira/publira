import type { Locale } from "@publira/i18n";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getMessagesFor } from "#lib/messages";
import { formatTenantAmount, readCurrency } from "#lib/price";
import { listPromotionCodeRedemptions } from "#lib/promotion-code";

import type { PromotionCodeParams } from "../_lib/search-params";
import { promotionCodeListQuery } from "../_lib/search-params";

interface PromotionCodeRedemptionsProps {
  codeId: string;
  locale: Locale;
  params: PromotionCodeParams;
  tenantId: string;
  timeZone: string;
}

/**
 * The purchases the code discounted, newest first: who bought, what, for how
 * much against the price before the code, and when, each linking to the
 * purchase's own drawer under Purchases.
 */
export const PromotionCodeRedemptions = async ({
  codeId,
  locale,
  params,
  tenantId,
  timeZone,
}: PromotionCodeRedemptionsProps) => {
  const [t, result] = await Promise.all([
    getMessagesFor(locale),
    listPromotionCodeRedemptions(tenantId, codeId, locale, {
      token: params.redemptions,
    }),
  ]);

  await redirectToLoginIfSessionRejected(result);

  const pageHref = (redemptions: string) =>
    promotionCodeListQuery({ code: codeId, redemptions, token: params.token });

  return (
    <section className="grid gap-3">
      <h3 className="text-base font-semibold">
        <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
          <Message message="admin.promotion_codes.redemptions.title" />
        </Suspense>
      </h3>

      {result.ok ? null : (
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.promotion_codes.redemptions.list_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {result.message}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      )}

      {result.ok && result.redemptions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message message="admin.promotion_codes.redemptions.empty" />
          </Suspense>
        </p>
      ) : null}

      {result.ok && result.redemptions.length > 0 ? (
        <>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.promotion_codes.redemptions.reader" />
                  </Suspense>
                </Table.Head>
                <Table.Head>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.promotion_codes.redemptions.purchase" />
                  </Suspense>
                </Table.Head>
                <Table.Head className="text-right">
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.promotion_codes.redemptions.list_price" />
                  </Suspense>
                </Table.Head>
                <Table.Head className="text-right">
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.promotion_codes.redemptions.paid" />
                  </Suspense>
                </Table.Head>
                <Table.Head>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.promotion_codes.redemptions.redeemed_at" />
                  </Suspense>
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {result.redemptions.map((redemption) => {
                const currency = readCurrency(redemption.currency);

                return (
                  <Table.Row key={redemption.id}>
                    <Table.Cell>
                      {redemption.readerPublicId ? (
                        <Link
                          className="underline-offset-4 hover:underline"
                          href={`/readers/${redemption.readerPublicId}`}
                        >
                          {redemption.readerEmail || redemption.readerPublicId}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">
                          <Suspense
                            fallback={<SkeletonLine className="h-4 w-24" />}
                          >
                            <Message message="admin.purchases.reader_deleted" />
                          </Suspense>
                        </span>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <div className="grid gap-0.5">
                        <Link
                          aria-label={t(
                            "admin.promotion_codes.redemptions.purchase_aria",
                            { title: redemption.title }
                          )}
                          className="font-medium underline-offset-4 hover:underline"
                          href={`/purchases?purchase=${redemption.purchaseId}`}
                        >
                          {redemption.title}
                        </Link>
                        {redemption.rental ? (
                          <span className="text-xs text-muted-foreground">
                            <Suspense
                              fallback={<SkeletonLine className="h-3 w-12" />}
                            >
                              <Message message="admin.promotion_codes.redemptions.rental" />
                            </Suspense>
                          </span>
                        ) : null}
                      </div>
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {formatTenantAmount(redemption.listPrice, {
                        currency,
                        locale,
                      })}
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {formatTenantAmount(redemption.price, {
                        currency,
                        locale,
                      })}
                    </Table.Cell>
                    <Table.Cell className="tabular-nums">
                      {formatDateTime(redemption.redeemedAt, {
                        locale,
                        timeZone,
                      })}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
          {result.previousToken || result.nextToken ? (
            <PaginationFooter.Root>
              <PaginationFooter.Description>
                {t("admin.promotion_codes.redemptions.pagination_description")}
              </PaginationFooter.Description>
              <PaginationFooter.Controls
                aria-label={t(
                  "admin.promotion_codes.redemptions.pagination_aria"
                )}
                nextHref={
                  result.nextToken ? pageHref(result.nextToken) : undefined
                }
                previousHref={
                  result.previousToken
                    ? pageHref(result.previousToken)
                    : undefined
                }
              />
            </PaginationFooter.Root>
          ) : null}
        </>
      ) : null}
    </section>
  );
};
