import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import {
  PurchasePaidThrough,
  PurchaseStatusChip,
} from "#components/purchase-status";
import { PurchasedItemName } from "#components/purchased-item-name";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";
import { formatTenantAmount, readCurrency } from "#lib/price";
import type { PurchaseItem } from "#lib/purchase";
import { purchasedItemLabel } from "#lib/purchased-item";

type ReaderPurchasesProps = CursorPageHrefs & {
  listErrorMessage?: string;
  locale: Locale;
  /** The instant a reading period is judged run out against. */
  now: Temporal.Instant;
  pageSize: number;
  providerNames: ReadonlyMap<string, string>;
  purchases: PurchaseItem[];
  timeZone: string;
};

/**
 * What one reader bought, with where each purchase stands, so a support case
 * about access can be answered from the reader's page. The reader column is
 * left out because every row names the same person; a purchase opens in the
 * purchases screen's drawer, where it can be refunded.
 */
export const ReaderPurchases = async ({
  listErrorMessage,
  locale,
  nextHref,
  now,
  pageSize,
  previousHref,
  providerNames,
  purchases,
  timeZone,
}: ReaderPurchasesProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (purchases.length > 0 || hasPageLinks);

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.readers.purchases_title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.readers.purchases_description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>

      {listErrorMessage ? (
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.readers.purchases_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {listErrorMessage}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      ) : null}

      {!listErrorMessage && purchases.length === 0 ? (
        <CursorPageEmptyState
          hasPageLinks={hasPageLinks}
          itemLabel={t("admin.purchases.item_label")}
        >
          <EmptyState.Heading>
            <EmptyState.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.readers.purchases_empty_title" />
              </Suspense>
            </EmptyState.Title>
            <EmptyState.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.readers.purchases_empty_description" />
              </Suspense>
            </EmptyState.Description>
          </EmptyState.Heading>
        </CursorPageEmptyState>
      ) : null}

      {!listErrorMessage && purchases.length > 0 ? (
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head className="w-44">
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.purchases.columns.purchased_at" />
                </Suspense>
              </Table.Head>
              <Table.Head>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.purchases.columns.item" />
                </Suspense>
              </Table.Head>
              <Table.Head className="w-28 text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.purchases.columns.amount" />
                </Suspense>
              </Table.Head>
              <Table.Head className="w-32">
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.purchases.columns.paid_through" />
                </Suspense>
              </Table.Head>
              <Table.Head className="w-40">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.purchases.columns.status" />
                </Suspense>
              </Table.Head>
              <Table.Head className="w-24">
                <span className="sr-only">
                  <Suspense fallback={null}>
                    <Message message="admin.purchases.columns.actions" />
                  </Suspense>
                </span>
              </Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {purchases.map((purchase) => (
              <Table.Row key={purchase.id}>
                <Table.Cell className="tabular-nums">
                  {formatDateTime(purchase.purchasedAt, { locale, timeZone })}
                </Table.Cell>
                <Table.Cell>
                  <div className="grid gap-0.5">
                    <PurchasedItemName purchase={purchase} t={t} />
                    <span className="text-xs text-muted-foreground">
                      {purchase.seriesTitle || purchase.seriesPublicId}
                    </span>
                  </div>
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums">
                  {formatTenantAmount(purchase.price, {
                    currency: readCurrency(purchase.currency),
                    locale,
                  })}
                </Table.Cell>
                <Table.Cell>
                  <PurchasePaidThrough
                    providerNames={providerNames}
                    purchase={purchase}
                  />
                </Table.Cell>
                <Table.Cell>
                  <PurchaseStatusChip now={now} purchase={purchase} />
                </Table.Cell>
                <Table.Cell>
                  <LinkButton
                    aria-label={t("admin.readers.purchases_view_aria", {
                      item: purchasedItemLabel(purchase, t),
                    })}
                    render={
                      <Link
                        href={`/purchases?purchase=${encodeURIComponent(purchase.id)}`}
                      />
                    }
                    size="sm"
                    variant="outline"
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
                      <Message message="admin.common.view_action" />
                    </Suspense>
                  </LinkButton>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      ) : null}

      {showPagination ? (
        <PaginationFooter.Root>
          <PaginationFooter.Description>
            {t("admin.purchases.pagination_description", { count: pageSize })}
          </PaginationFooter.Description>
          <PaginationFooter.Controls
            aria-label={t("admin.readers.purchases_pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </PaginationFooter.Root>
      ) : null}
    </ConsoleSection.Root>
  );
};
