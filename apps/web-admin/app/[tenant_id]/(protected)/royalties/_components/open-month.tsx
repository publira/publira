import type { Locale } from "@publira/i18n";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import * as EmptyState from "@publira/ui-components/empty-state";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  formatDateTime,
  formatPlainDate,
  formatPlainYearMonth,
} from "@publira/utils";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionActions,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSections,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { formatTenantAmount } from "#lib/price";
import type { RoyaltyTotals } from "#lib/royalties";
import type { RoyaltyLine } from "#lib/royalty-lines";
import type { RoyaltyCloseState } from "#lib/royalty-period";

import { CloseStatementButton } from "./close-statement-button";
import { RoyaltyFigures } from "./royalty-figures";
import { RoyaltyLinesTable } from "./royalty-lines-table";

interface OpenMonthProps {
  closeState: RoyaltyCloseState;
  /**
   * The currency every amount is in, the statement's or the preview's.
   * `null` when the API answered none, and each amount is then a dash.
   */
  currency: string | null;
  /** RFC 3339 instant the month stops counting sales at, exclusive. */
  endsAt: string;
  lines: RoyaltyLine[];
  locale: Locale;
  period: string;
  /** RFC 3339 instant the month starts counting sales at. */
  startsAt: string;
  tenantId: string;
  timeZone: string;
  totals: RoyaltyTotals;
}

/** What happens to the month next, and the close button when it is a person's. */
const CloseStatus = ({
  closeState,
  currency,
  locale,
  period,
  tenantId,
  totals,
}: Pick<
  OpenMonthProps,
  "closeState" | "currency" | "locale" | "period" | "tenantId" | "totals"
>) => {
  switch (closeState.kind) {
    case "automatic": {
      return (
        <p className="text-sm">
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message
              message="admin.royalties.open.auto_scheduled"
              values={{
                date: formatPlainDate(closeState.closeDate, { locale }),
              }}
            />
          </Suspense>
        </p>
      );
    }
    case "in-progress": {
      return (
        <p className="text-sm">
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message
              message="admin.royalties.open.in_progress"
              values={{ date: formatPlainDate(closeState.lastDay, { locale }) }}
            />
          </Suspense>
        </p>
      );
    }
    case "ready": {
      const periodLabel = formatPlainYearMonth(period, { locale });
      return (
        <div className="grid gap-3">
          <p className="text-sm">
            <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
              <Message message="admin.royalties.open.ready" />
            </Suspense>
          </p>
          <CloseStatementButton period={period} tenantId={tenantId}>
            <ConfirmDialog.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
                <Message
                  message="admin.royalties.close.confirm_title"
                  values={{ period: periodLabel }}
                />
              </Suspense>
            </ConfirmDialog.Title>
            <ConfirmDialog.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message
                  message="admin.royalties.close.confirm_description"
                  values={{
                    payout: formatTenantAmount(totals.payout, {
                      currency,
                      locale,
                    }),
                  }}
                />
              </Suspense>
            </ConfirmDialog.Description>
          </CloseStatementButton>
        </div>
      );
    }
    default: {
      return null;
    }
  }
};

/**
 * A month that is not closed, as closing it now would record it: the instants
 * it counts sales between, its totals, its lines grouped by author, and what
 * happens to it next. The instants are stated rather than derived from the
 * period: a month beside a closed one starts or ends where that statement
 * does, which is not its own midnight once the tenant's zone has changed.
 */
export const OpenMonth = ({
  closeState,
  currency,
  endsAt,
  lines,
  locale,
  period,
  startsAt,
  tenantId,
  timeZone,
  totals,
}: OpenMonthProps) => (
  <AdminSections>
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message
                message="admin.royalties.open.title"
                values={{ period: formatPlainYearMonth(period, { locale }) }}
              />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
              <Message
                message="admin.royalties.open.period_note"
                values={{
                  end: formatDateTime(endsAt, { locale, timeZone }),
                  start: formatDateTime(startsAt, { locale, timeZone }),
                  time_zone: timeZone,
                }}
              />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
        <AdminSectionActions>
          <p className="text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="admin.royalties.export.open_month_note" />
            </Suspense>
          </p>
          <Button disabled type="button" variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.royalties.export.button" />
            </Suspense>
          </Button>
        </AdminSectionActions>
      </AdminSectionHeader>
      <RoyaltyFigures currency={currency} locale={locale} totals={totals} />
      <CloseStatus
        closeState={closeState}
        currency={currency}
        locale={locale}
        period={period}
        tenantId={tenantId}
        totals={totals}
      />
    </AdminSection>

    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="admin.royalties.lines.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
              <Message message="admin.royalties.lines.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      {lines.length === 0 ? (
        <EmptyState.Root>
          <EmptyState.Heading>
            <EmptyState.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message message="admin.royalties.lines.empty_title" />
              </Suspense>
            </EmptyState.Title>
            <EmptyState.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.royalties.lines.empty_description" />
              </Suspense>
            </EmptyState.Description>
          </EmptyState.Heading>
        </EmptyState.Root>
      ) : (
        <RoyaltyLinesTable currency={currency} lines={lines} locale={locale} />
      )}
    </AdminSection>
  </AdminSections>
);
