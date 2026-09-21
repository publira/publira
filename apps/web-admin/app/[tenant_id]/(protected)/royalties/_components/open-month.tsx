import type { Locale } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  formatPlainDate,
  formatPlainYearMonth,
  formatYen,
} from "@publira/utils";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSections,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import type { RoyaltyTotals } from "#lib/royalties";
import type { RoyaltyLine } from "#lib/royalty-lines";
import { royaltyPeriodLastDay } from "#lib/royalty-period";
import type { RoyaltyCloseState } from "#lib/royalty-period";

import { CloseStatementButton } from "./close-statement-button";
import { RoyaltyFigures } from "./royalty-figures";
import { RoyaltyLinesTable } from "./royalty-lines-table";

interface OpenMonthProps {
  closeState: RoyaltyCloseState;
  lines: RoyaltyLine[];
  locale: Locale;
  period: string;
  timeZone: string;
  totals: RoyaltyTotals;
}

/** What happens to the month next, and the close button when it is a person's. */
const CloseStatus = ({
  closeState,
  locale,
  period,
  totals,
}: Pick<OpenMonthProps, "closeState" | "locale" | "period" | "totals">) => {
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
          <CloseStatementButton
            confirmDescription={
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message
                  message="admin.royalties.close.confirm_description"
                  values={{ payout: formatYen(totals.payout, { locale }) }}
                />
              </Suspense>
            }
            confirmTitle={
              <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
                <Message
                  message="admin.royalties.close.confirm_title"
                  values={{ period: periodLabel }}
                />
              </Suspense>
            }
            period={period}
          />
        </div>
      );
    }
    default: {
      return null;
    }
  }
};

/**
 * A month that is not closed, as closing it now would record it: its totals,
 * its lines grouped by author, and what happens to it next.
 */
export const OpenMonth = ({
  closeState,
  lines,
  locale,
  period,
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
                  end: formatPlainDate(royaltyPeriodLastDay(period), {
                    locale,
                  }),
                  start: formatPlainDate(`${period}-01`, { locale }),
                  time_zone: timeZone,
                }}
              />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <RoyaltyFigures locale={locale} totals={totals} />
      <CloseStatus
        closeState={closeState}
        locale={locale}
        period={period}
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
        <EmptyState>
          <EmptyStateHeading>
            <EmptyStateTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message message="admin.royalties.lines.empty_title" />
              </Suspense>
            </EmptyStateTitle>
            <EmptyStateDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.royalties.lines.empty_description" />
              </Suspense>
            </EmptyStateDescription>
          </EmptyStateHeading>
        </EmptyState>
      ) : (
        <RoyaltyLinesTable lines={lines} locale={locale} />
      )}
    </AdminSection>
  </AdminSections>
);
