import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDateTime, formatPlainDate } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";
import type { PaymentReconciliationItem } from "#lib/payment-reconciliation";

import {
  ReconciliationFailure,
  reconciliationSourceName,
  ReconciliationSource,
  ReconciliationStatusChip,
} from "./reconciliation-labels";

type ReconciliationListProps = CursorPageHrefs & {
  /** The href that opens the drawer on a run, keeping the list's page. */
  detailHref: (runId: string) => string;
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
  providerNames: ReadonlyMap<string, string>;
  reconciliations: PaymentReconciliationItem[];
  timeZone: string;
};

/** A count a run reports once it has succeeded, and a dash before then. */
const countOf = (
  run: PaymentReconciliationItem,
  value: bigint,
  locale: Locale
): string =>
  run.status === "succeeded"
    ? new Intl.NumberFormat(toIntlLocale(locale)).format(value)
    : "-";

export const ReconciliationList = async ({
  detailHref,
  listErrorMessage,
  locale,
  nextHref,
  pageSize,
  previousHref,
  providerNames,
  reconciliations,
  timeZone,
}: ReconciliationListProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });

  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.reconciliation.list_error" />
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
    <PaginationFooter.Root>
      <PaginationFooter.Description>
        {t("admin.reconciliation.pagination_description", {
          count: pageSize,
        })}
      </PaginationFooter.Description>
      <PaginationFooter.Controls
        aria-label={t("admin.reconciliation.pagination_aria")}
        nextHref={nextHref}
        previousHref={previousHref}
      />
    </PaginationFooter.Root>
  );

  if (reconciliations.length === 0) {
    return (
      <div className="grid gap-6">
        <CursorPageEmptyState
          hasPageLinks={hasPageLinks}
          itemLabel={t("admin.reconciliation.item_label")}
        >
          <EmptyState.Heading>
            <EmptyState.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message message="admin.reconciliation.empty_title" />
              </Suspense>
            </EmptyState.Title>
            <EmptyState.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.reconciliation.empty_description" />
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
            <Table.Head>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.reconciliation.columns.source" />
              </Suspense>
            </Table.Head>
            <Table.Head>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.reconciliation.columns.period" />
              </Suspense>
            </Table.Head>
            <Table.Head>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.reconciliation.columns.status" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-44">
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.reconciliation.columns.started_at" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-24 text-right">
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.reconciliation.columns.records" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-24 text-right">
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.reconciliation.columns.purchases" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-24 text-right">
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.reconciliation.columns.matched" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-24 text-right">
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.reconciliation.columns.findings" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-24">
              <span className="sr-only">
                <Suspense fallback={null}>
                  <Message message="admin.reconciliation.columns.actions" />
                </Suspense>
              </span>
            </Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {reconciliations.map((run) => (
            <Table.Row key={run.id}>
              <Table.Cell className="font-medium">
                <ReconciliationSource providerNames={providerNames} run={run} />
              </Table.Cell>
              <Table.Cell className="tabular-nums">
                {t("admin.reconciliation.period_range", {
                  end: formatPlainDate(run.endDate, { locale }),
                  start: formatPlainDate(run.startDate, { locale }),
                })}
              </Table.Cell>
              <Table.Cell>
                <div className="grid justify-items-start gap-1">
                  <ReconciliationStatusChip status={run.status} />
                  {run.status === "failed" ? (
                    <span className="text-xs text-muted-foreground">
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <ReconciliationFailure run={run} />
                      </Suspense>
                    </span>
                  ) : null}
                </div>
              </Table.Cell>
              <Table.Cell className="tabular-nums">
                {formatDateTime(run.startedAt, { locale, timeZone })}
              </Table.Cell>
              <Table.Cell className="text-right tabular-nums">
                {countOf(run, run.recordCount, locale)}
              </Table.Cell>
              <Table.Cell className="text-right tabular-nums">
                {countOf(run, run.purchaseCount, locale)}
              </Table.Cell>
              <Table.Cell className="text-right tabular-nums">
                {countOf(run, run.matchedCount, locale)}
              </Table.Cell>
              <Table.Cell className="text-right font-medium tabular-nums">
                {countOf(run, run.findingCount, locale)}
              </Table.Cell>
              <Table.Cell>
                <LinkButton
                  aria-label={t("admin.reconciliation.view_aria", {
                    end: formatPlainDate(run.endDate, { locale }),
                    source: reconciliationSourceName(run, providerNames, t),
                    start: formatPlainDate(run.startDate, { locale }),
                  })}
                  render={<Link href={detailHref(run.id)} scroll={false} />}
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
