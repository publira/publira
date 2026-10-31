import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
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

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
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

  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);

  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.royalties.statement.title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "period");

const statementParamsSchema = z.object({
  period: routeParamString().pipe(royaltyPeriodSchema),
});

const StatementSkeleton = () => (
  <ConsoleSection.Stack>
    <ConsoleSection.Root>
      <SkeletonLine className="h-5 w-48" />
      <Skeleton className="h-24" />
    </ConsoleSection.Root>
    <ConsoleSection.Root>
      <SkeletonLine className="h-5 w-32" />
      <Table.Skeleton />
    </ConsoleSection.Root>
  </ConsoleSection.Stack>
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
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.royalties.statement.section_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
        <SectionError.Actions>
          <LinkButton
            render={<Link href="/royalties/statements" />}
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.royalties.statement.back_to_list" />
            </Suspense>
          </LinkButton>
        </SectionError.Actions>
      </SectionError.Root>
    );
  }

  const { statement } = result;
  const pageHrefs = cursorPageHrefs(result);
  const hasPageLinks = hasCursorPageLinks(pageHrefs);
  const closedAt = formatDateTime(statement.closedAt, { locale, timeZone });

  return (
    <ConsoleSection.Stack>
      <ConsoleSection.Root>
        <ConsoleSection.Header>
          <ConsoleSection.Heading>
            <ConsoleSection.Title>
              {formatPlainYearMonth(statement.period, { locale })}
            </ConsoleSection.Title>
            <ConsoleSection.Description>
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
            </ConsoleSection.Description>
          </ConsoleSection.Heading>
          <ConsoleSection.Actions>
            <LinkButton
              href={royaltyStatementCsvPath(statement.period)}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.royalties.export.button" />
              </Suspense>
            </LinkButton>
          </ConsoleSection.Actions>
        </ConsoleSection.Header>
        <RoyaltyFigures
          currency={statement.currency}
          locale={locale}
          totals={statement.totals}
        />
      </ConsoleSection.Root>

      <ConsoleSection.Root>
        <ConsoleSection.Header>
          <ConsoleSection.Heading>
            <ConsoleSection.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
                <Message message="admin.royalties.lines.title" />
              </Suspense>
            </ConsoleSection.Title>
            <ConsoleSection.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.royalties.lines.description" />{" "}
                <Message message="admin.royalties.statement.subtotal_note" />
              </Suspense>
            </ConsoleSection.Description>
          </ConsoleSection.Heading>
        </ConsoleSection.Header>
        {result.lines.length === 0 ? (
          <CursorPageEmptyState
            hasPageLinks={hasPageLinks}
            itemLabel={t("admin.royalties.statement.item_label")}
          >
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
          </CursorPageEmptyState>
        ) : (
          <RoyaltyLinesTable
            currency={statement.currency}
            lines={result.lines}
            locale={locale}
          />
        )}
        {result.lines.length > 0 || hasPageLinks ? (
          <PaginationFooter.Root>
            <PaginationFooter.Description>
              {t("admin.royalties.statement.pagination_description", {
                count: String(DEFAULT_PAGE_SIZE),
              })}
            </PaginationFooter.Description>
            <PaginationFooter.Controls
              {...pageHrefs}
              aria-label={t("admin.royalties.statement.pagination_aria")}
            />
          </PaginationFooter.Root>
        ) : null}
      </ConsoleSection.Root>
    </ConsoleSection.Stack>
  );
};

const RoyaltyStatementPage = ({
  params,
  searchParams,
}: RoyaltyStatementPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
                <Message message="admin.royalties.statement.title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.royalties.statement.page_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
          <ConsolePage.Actions>
            <LinkButton
              render={<Link href="/royalties/statements" />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.royalties.statement.back_to_list" />
              </Suspense>
            </LinkButton>
          </ConsolePage.Actions>
        </ConsolePage.Header>
        <ConsolePage.Content>
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
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default RoyaltyStatementPage;
