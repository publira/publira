import type { Locale } from "@publira/i18n";
import { StatusChip } from "@publira/ui-components/badge";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as Identifier from "@publira/ui-components/identifier";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime, formatPlainDate } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import * as GroupNav from "#components/group-nav";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { DEFAULT_PAGE_SIZE } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";
import {
  isReconciliationUnfinished,
  listPaymentReconciliationFindings,
} from "#lib/payment-reconciliation";
import type {
  PaymentReconciliationFindingItem,
  PaymentReconciliationItem,
} from "#lib/payment-reconciliation";
import { formatTenantAmount, readCurrency } from "#lib/price";

import type { ReconciliationSearchParams } from "../_lib/search-params";
import { reconciliationQuery } from "../_lib/search-params";
import {
  FindingKindLabel,
  ReconciliationFailure,
  ReconciliationSource,
  ReconciliationStatusChip,
} from "./reconciliation-labels";

interface ReconciliationFindingsProps {
  locale: Locale;
  providerNames: ReadonlyMap<string, string>;
  /**
   * The run as the list behind the drawer has it, or `undefined` when the
   * link named a run that is not on the list's page: its lines are still
   * listed, without the summary the list would have given.
   */
  run: PaymentReconciliationItem | undefined;
  searchParams: ReconciliationSearchParams;
  tenantId: string;
  timeZone: string;
}

const labelClassName = "text-sm text-muted-foreground";
const valueClassName = "min-w-0 text-sm tabular-nums";

/**
 * What one side of a line came to: the amount, and what of it was refunded,
 * or a dash where that side has nothing to say.
 */
const sideAmount = (
  amount: bigint,
  refunded: bigint,
  currency: string,
  locale: Locale,
  t: AdminMessageAccessor
): string => {
  const code = readCurrency(currency);

  if (!code) {
    return "-";
  }

  const paid = formatTenantAmount(amount, { currency: code, locale });

  return refunded > 0n
    ? t("admin.reconciliation.findings.amount_refunded", {
        amount: paid,
        refunded: formatTenantAmount(refunded, { currency: code, locale }),
      })
    : paid;
};

const FindingItem = ({
  finding,
  locale,
  t,
  timeZone,
}: {
  finding: PaymentReconciliationFindingItem;
  locale: Locale;
  t: AdminMessageAccessor;
  timeZone: string;
}) => (
  <li className="grid gap-3 border-b border-border py-4 last:border-b-0">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex flex-wrap items-center gap-2 font-medium">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <FindingKindLabel kind={finding.kind} />
        </Suspense>
        {finding.test ? (
          <StatusChip status="muted">
            <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
              <Message message="admin.reconciliation.findings.test" />
            </Suspense>
          </StatusChip>
        ) : null}
      </span>
      <span className="text-sm text-muted-foreground tabular-nums">
        {formatDateTime(finding.occurredAt, { locale, timeZone })}
      </span>
    </div>
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className={labelClassName}>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="admin.reconciliation.findings.payment_id" />
        </Suspense>
      </dt>
      <dd className={valueClassName}>
        {finding.providerPaymentId ? (
          <Identifier.Root>
            <Identifier.Value>{finding.providerPaymentId}</Identifier.Value>
            <Identifier.Copy
              aria-label={t("admin.reconciliation.findings.copy_payment_id")}
              value={finding.providerPaymentId}
            />
          </Identifier.Root>
        ) : (
          "-"
        )}
      </dd>

      <dt className={labelClassName}>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="admin.reconciliation.findings.purchase_amount" />
        </Suspense>
      </dt>
      <dd className={valueClassName}>
        {sideAmount(
          finding.purchaseAmount,
          finding.purchaseRefundedAmount,
          finding.purchaseCurrency,
          locale,
          t
        )}
      </dd>

      <dt className={labelClassName}>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="admin.reconciliation.findings.record_amount" />
        </Suspense>
      </dt>
      <dd className={valueClassName}>
        {sideAmount(
          finding.recordAmount,
          finding.recordRefundedAmount,
          finding.recordCurrency,
          locale,
          t
        )}
      </dd>

      {finding.purchaseId ? (
        <>
          <dt className={labelClassName}>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.reconciliation.findings.purchase" />
            </Suspense>
          </dt>
          <dd className={valueClassName}>
            <Link
              className="font-medium underline-offset-4 hover:underline"
              href={`/purchases?purchase=${finding.purchaseId}`}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.reconciliation.findings.open_purchase" />
              </Suspense>
            </Link>
          </dd>
        </>
      ) : null}
    </dl>
  </li>
);

/** The run as the list has it: where it read, which days, and how it ended. */
const RunSummary = ({
  locale,
  providerNames,
  run,
  t,
}: {
  locale: Locale;
  providerNames: ReadonlyMap<string, string>;
  run: PaymentReconciliationItem;
  t: AdminMessageAccessor;
}) => (
  <div className="grid gap-2">
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">
        <ReconciliationSource providerNames={providerNames} run={run} />
      </span>
      <span className="text-muted-foreground tabular-nums">
        {t("admin.reconciliation.period_range", {
          end: formatPlainDate(run.endDate, { locale }),
          start: formatPlainDate(run.startDate, { locale }),
        })}
      </span>
      <ReconciliationStatusChip status={run.status} />
    </p>
    {run.status === "succeeded" ? (
      <p className="text-sm text-muted-foreground">
        {t("admin.reconciliation.findings.summary", {
          findings: run.findingCount,
          matched: run.matchedCount,
          purchases: run.purchaseCount,
          records: run.recordCount,
        })}
      </p>
    ) : null}
    {run.status === "failed" ? (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <ReconciliationFailure run={run} />
        </Suspense>
      </p>
    ) : null}
  </div>
);

/**
 * The lines of the run the URL names, narrowed by kind and by mode. Each
 * filter is a link, so the choice is in the URL with the run, and changing
 * one starts its lines from the first page, as the API asks.
 */
export const ReconciliationFindings = async ({
  locale,
  providerNames,
  run,
  searchParams,
  tenantId,
  timeZone,
}: ReconciliationFindingsProps) => {
  const [t, result] = await Promise.all([
    getMessagesFor(locale),
    listPaymentReconciliationFindings(tenantId, locale, {
      kind: searchParams.kind,
      mode: searchParams.mode,
      reconciliationId: searchParams.run,
      token: searchParams.findingsToken,
    }),
  ]);

  await redirectToLoginIfSessionRejected(result);

  const filterHref = (
    filter: Pick<ReconciliationSearchParams, "kind" | "mode">
  ) =>
    reconciliationQuery({
      ...searchParams,
      ...filter,
      findingsToken: "",
    });

  const pageHref = (findingsToken: string) =>
    findingsToken
      ? reconciliationQuery({ ...searchParams, findingsToken })
      : undefined;

  const summary = run ? (
    <RunSummary locale={locale} providerNames={providerNames} run={run} t={t} />
  ) : null;

  if (!result.ok) {
    return (
      <div className="grid gap-5">
        {summary}
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.reconciliation.findings.list_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {result.message}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      </div>
    );
  }

  const { kind, mode } = searchParams;

  return (
    <div className="grid gap-5">
      {summary}

      <div className="grid gap-3">
        <GroupNav.Root
          aria-label={t("admin.reconciliation.findings.kind_aria")}
        >
          <GroupNav.Link
            current={kind === ""}
            href={filterHref({ kind: "", mode })}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
              <Message message="admin.reconciliation.findings.every_kind" />
            </Suspense>
          </GroupNav.Link>
          <GroupNav.Link
            current={kind === "record_unmatched"}
            href={filterHref({ kind: "record_unmatched", mode })}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.reconciliation.kind.record_unmatched" />
            </Suspense>
          </GroupNav.Link>
          <GroupNav.Link
            current={kind === "purchase_unmatched"}
            href={filterHref({ kind: "purchase_unmatched", mode })}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.reconciliation.kind.purchase_unmatched" />
            </Suspense>
          </GroupNav.Link>
          <GroupNav.Link
            current={kind === "amount_mismatch"}
            href={filterHref({ kind: "amount_mismatch", mode })}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.reconciliation.kind.amount_mismatch" />
            </Suspense>
          </GroupNav.Link>
          <GroupNav.Link
            current={kind === "held_refund"}
            href={filterHref({ kind: "held_refund", mode })}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.reconciliation.kind.held_refund" />
            </Suspense>
          </GroupNav.Link>
          <GroupNav.Link
            current={kind === "held_dispute"}
            href={filterHref({ kind: "held_dispute", mode })}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.reconciliation.kind.held_dispute" />
            </Suspense>
          </GroupNav.Link>
        </GroupNav.Root>
        <GroupNav.Root
          aria-label={t("admin.reconciliation.findings.mode_aria")}
        >
          <GroupNav.Link
            current={mode === ""}
            href={filterHref({ kind, mode: "" })}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.reconciliation.findings.every_mode" />
            </Suspense>
          </GroupNav.Link>
          <GroupNav.Link
            current={mode === "live"}
            href={filterHref({ kind, mode: "live" })}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.reconciliation.findings.live" />
            </Suspense>
          </GroupNav.Link>
          <GroupNav.Link
            current={mode === "test"}
            href={filterHref({ kind, mode: "test" })}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.reconciliation.findings.test" />
            </Suspense>
          </GroupNav.Link>
        </GroupNav.Root>
      </div>

      {result.findings.length === 0 ? (
        <EmptyState.Root>
          <EmptyState.Heading>
            <EmptyState.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                {run && isReconciliationUnfinished(run) ? (
                  <Message message="admin.reconciliation.findings.unfinished" />
                ) : (
                  <Message message="admin.reconciliation.findings.empty" />
                )}
              </Suspense>
            </EmptyState.Title>
          </EmptyState.Heading>
        </EmptyState.Root>
      ) : (
        <ul className="grid">
          {result.findings.map((finding) => (
            <FindingItem
              finding={finding}
              key={finding.id}
              locale={locale}
              t={t}
              timeZone={timeZone}
            />
          ))}
        </ul>
      )}

      {result.previousToken || result.nextToken ? (
        <PaginationFooter.Root>
          <PaginationFooter.Description>
            {t("admin.reconciliation.findings.pagination_description", {
              count: DEFAULT_PAGE_SIZE,
            })}
          </PaginationFooter.Description>
          <PaginationFooter.Controls
            aria-label={t("admin.reconciliation.findings.pagination_aria")}
            nextHref={pageHref(result.nextToken)}
            previousHref={pageHref(result.previousToken)}
          />
        </PaginationFooter.Root>
      ) : null}
    </div>
  );
};
