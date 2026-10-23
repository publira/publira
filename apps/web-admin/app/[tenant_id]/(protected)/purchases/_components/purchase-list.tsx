import type { Locale } from "@publira/i18n";
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
import {
  PaginationControls,
  PaginationFooter,
  PaginationFooterDescription,
} from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";
import { formatTenantAmount, readCurrency } from "#lib/price";
import type { PurchaseItem } from "#lib/purchase";

import { purchasedItemLabel } from "../_lib/purchased-item";
import { PurchasePaidThrough, PurchaseStatusChip } from "./purchase-status";

type PurchaseListProps = CursorPageHrefs & {
  /** The href that opens the drawer on a purchase, keeping the list's page. */
  detailHref: (purchaseId: string) => string;
  listErrorMessage?: string;
  locale: Locale;
  /** The instant a reading period is judged run out against. */
  now: Temporal.Instant;
  pageSize: number;
  providerNames: ReadonlyMap<string, string>;
  purchases: PurchaseItem[];
  timeZone: string;
};

/** The reader, or that their account is gone with who they were. */
const ReaderCell = ({ purchase }: { purchase: PurchaseItem }) =>
  purchase.readerPublicId ? (
    <div className="grid gap-0.5">
      <span className="font-medium">
        {purchase.readerName || purchase.readerPublicId}
      </span>
      <span className="text-xs text-muted-foreground">
        {purchase.readerEmail}
      </span>
    </div>
  ) : (
    <span className="text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <Message message="admin.purchases.reader_deleted" />
      </Suspense>
    </span>
  );

export const PurchaseList = async ({
  detailHref,
  listErrorMessage,
  locale,
  nextHref,
  now,
  pageSize,
  previousHref,
  providerNames,
  purchases,
  timeZone,
}: PurchaseListProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });

  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.purchases.list_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const pagination = (
    <PaginationFooter>
      <PaginationFooterDescription>
        {t("admin.purchases.pagination_description", { count: pageSize })}
      </PaginationFooterDescription>
      <PaginationControls
        aria-label={t("admin.purchases.pagination_aria")}
        nextHref={nextHref}
        previousHref={previousHref}
      />
    </PaginationFooter>
  );

  if (purchases.length === 0) {
    return (
      <div className="grid gap-6">
        <CursorPageEmptyState
          hasPageLinks={hasPageLinks}
          itemLabel={t("admin.purchases.item_label")}
        >
          <EmptyState.Heading>
            <EmptyState.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message message="admin.purchases.empty_title" />
              </Suspense>
            </EmptyState.Title>
            <EmptyState.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.purchases.empty_description" />
              </Suspense>
            </EmptyState.Description>
          </EmptyState.Heading>
        </CursorPageEmptyState>
        {hasPageLinks ? pagination : null}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
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
                <Message message="admin.purchases.columns.reader" />
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
                <ReaderCell purchase={purchase} />
              </Table.Cell>
              <Table.Cell>
                <div className="grid gap-0.5">
                  <span className="font-medium">
                    {purchasedItemLabel(purchase, t)}
                  </span>
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
                  aria-label={t("admin.purchases.view_aria", {
                    item: purchasedItemLabel(purchase, t),
                    reader:
                      purchase.readerName ||
                      purchase.readerEmail ||
                      t("admin.purchases.reader_deleted"),
                  })}
                  render={
                    <Link href={detailHref(purchase.id)} scroll={false} />
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

      {pagination}
    </div>
  );
};
