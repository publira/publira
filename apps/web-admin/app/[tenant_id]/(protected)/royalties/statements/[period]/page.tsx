import { LinkButton } from "@publira/ui-components/button";
import {
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import {
  SectionError,
  SectionErrorActions,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { TableSkeleton } from "@publira/ui-components/table";
import { formatDateTime, formatPlainYearMonth } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
  AdminSection,
  AdminSectionActions,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSections,
  AdminSectionTitle,
} from "#components/admin-page";
import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import {
  PaginationControls,
  PaginationFooter,
  PaginationFooterDescription,
} from "#components/pagination-controls";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  hasCursorPageLinks,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getRoyaltyStatement } from "#lib/royalties";
import {
  royaltyPeriodSchema,
  royaltyStatementCsvPath,
} from "#lib/royalty-period";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { RoyaltyFigures } from "../../_components/royalty-figures";
import { RoyaltyLinesTable } from "../../_components/royalty-lines-table";

type RoyaltyStatementPageProps =
  PageProps<"/[tenant_id]/royalties/statements/[period]">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.royalties.statement.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "period");

const statementParamsSchema = z.object({
  period: routeParamString().pipe(royaltyPeriodSchema),
});

const StatementSkeleton = () => (
  <AdminSections>
    <AdminSection>
      <SkeletonLine className="h-5 w-48" />
      <Skeleton className="h-24" />
    </AdminSection>
    <AdminSection>
      <SkeletonLine className="h-5 w-32" />
      <TableSkeleton />
    </AdminSection>
  </AdminSections>
);

const StatementContent = async ({
  params,
  searchParams,
}: Pick<RoyaltyStatementPageProps, "params" | "searchParams">) => {
  const [rawParams, sp, tenantId] = await Promise.all([
    params,
    searchParams,
    getTenantId(),
  ]);
  const parsedParams = parseRouteParams(statementParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { token } = parseCursorSearchParams(sp);
  const locale = await getLocale(tenantId);
  const [result, timeZone, t] = await Promise.all([
    getRoyaltyStatement(tenantId, locale, parsedParams.period, {
      limit: DEFAULT_PAGE_SIZE,
      token,
    }),
    getTenantDisplayTimeZone(tenantId),
    getMessagesFor(locale),
  ]);

  if (!result.ok) {
    if (result.notFound) {
      notFound();
    }
    await redirectToLoginIfSessionRejected(result);

    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.royalties.statement.section_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
        <SectionErrorActions>
          <LinkButton
            render={<Link href="/royalties/statements" />}
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.royalties.statement.back_to_list" />
            </Suspense>
          </LinkButton>
        </SectionErrorActions>
      </SectionError>
    );
  }

  const { statement } = result;
  const pageHrefs = cursorPageHrefs(result);
  const hasPageLinks = hasCursorPageLinks(pageHrefs);
  const closedAt = formatDateTime(statement.closedAt, { locale, timeZone });

  return (
    <AdminSections>
      <AdminSection>
        <AdminSectionHeader>
          <AdminSectionHeading>
            <AdminSectionTitle>
              {formatPlainYearMonth(statement.period, { locale })}
            </AdminSectionTitle>
            <AdminSectionDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                {statement.closedByUserName ? (
                  <Message
                    message="admin.royalties.statement.closed_meta"
                    values={{
                      closed_at: closedAt,
                      name: statement.closedByUserName,
                    }}
                  />
                ) : (
                  <Message
                    message="admin.royalties.statement.closed_meta_no_user"
                    values={{ closed_at: closedAt }}
                  />
                )}{" "}
                <Message
                  message="admin.royalties.statement.time_zone"
                  values={{ time_zone: statement.timeZone }}
                />
              </Suspense>
            </AdminSectionDescription>
          </AdminSectionHeading>
          <AdminSectionActions>
            <LinkButton
              href={royaltyStatementCsvPath(statement.period)}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.royalties.export.button" />
              </Suspense>
            </LinkButton>
          </AdminSectionActions>
        </AdminSectionHeader>
        <RoyaltyFigures locale={locale} totals={statement.totals} />
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
                <Message message="admin.royalties.lines.description" />{" "}
                <Message message="admin.royalties.statement.subtotal_note" />
              </Suspense>
            </AdminSectionDescription>
          </AdminSectionHeading>
        </AdminSectionHeader>
        {result.lines.length === 0 ? (
          <CursorPageEmptyState
            hasPageLinks={hasPageLinks}
            itemLabel={t("admin.royalties.statement.item_label")}
          >
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
          </CursorPageEmptyState>
        ) : (
          <RoyaltyLinesTable lines={result.lines} locale={locale} />
        )}
        {result.lines.length > 0 || hasPageLinks ? (
          <PaginationFooter>
            <PaginationFooterDescription>
              {t("admin.royalties.statement.pagination_description", {
                count: String(DEFAULT_PAGE_SIZE),
              })}
            </PaginationFooterDescription>
            <PaginationControls
              {...pageHrefs}
              aria-label={t("admin.royalties.statement.pagination_aria")}
            />
          </PaginationFooter>
        ) : null}
      </AdminSection>
    </AdminSections>
  );
};

const RoyaltyStatementPage = ({
  params,
  searchParams,
}: RoyaltyStatementPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
            <Message message="admin.royalties.statement.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.royalties.statement.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton
          render={<Link href="/royalties/statements" />}
          variant="outline"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.royalties.statement.back_to_list" />
          </Suspense>
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <FlashToast keyName="closed" message="admin.royalties.close.done" />
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.royalties.statement.section_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<StatementSkeleton />}>
          <StatementContent params={params} searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </AdminPageContent>
  </AdminPage>
);

export default RoyaltyStatementPage;
