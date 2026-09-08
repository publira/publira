import { getMessage } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { listCommentReports, listComments } from "#lib/comment";
import { DEFAULT_PAGE_SIZE } from "#lib/cursor-page";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { buildQueryString } from "#lib/query-string";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { CommentFilterForm } from "./_components/comment-filter-form";
import { CommentManager } from "./_components/comment-manager";
import { CommentReportQueue } from "./_components/comment-report-queue";
import type { CommentReportStatusOption } from "./_components/comment-report-queue";
import { parseCommentFilters } from "./_lib/search-params";
import type { CommentFilters } from "./_lib/search-params";
import { COMMENT_REPORT_STATUSES } from "./comment-types";

type CommentsPageProps = PageProps<"/[tenant_id]/comments">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.comments.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const CommentsSkeleton = () => (
  <div className="grid gap-6">
    <div className="rounded-2xl border border-border/70 bg-card p-6">
      <div className="mb-4 h-6 w-44 animate-pulse rounded bg-muted" />
      <div className="grid gap-3">
        <div className="h-16 animate-pulse rounded bg-muted/70" />
        <div className="h-16 animate-pulse rounded bg-muted/70" />
      </div>
    </div>
    <div className="rounded-2xl border border-border/70 bg-card p-6">
      <div className="mb-4 h-6 w-32 animate-pulse rounded bg-muted" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="h-16 animate-pulse rounded bg-muted/70" />
        <div className="h-16 animate-pulse rounded bg-muted/70" />
        <div className="h-16 animate-pulse rounded bg-muted/70" />
        <div className="h-16 animate-pulse rounded bg-muted/70" />
      </div>
    </div>
    <div className="rounded-2xl border border-border/70 bg-card p-6">
      <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
      <div className="grid gap-3">
        <div className="h-16 animate-pulse rounded bg-muted/70" />
        <div className="h-16 animate-pulse rounded bg-muted/70" />
        <div className="h-16 animate-pulse rounded bg-muted/70" />
      </div>
    </div>
  </div>
);

/**
 * Query-only href that keeps every filter on the screen while the operator
 * walks the pages of one of its two lists.
 *
 * Both lists live on this URL, so each link carries the other one's state as
 * well: paging the comments would otherwise send the report queue back to its
 * first page, and switching the report state would drop the comment filters.
 */
const commentScreenQuery = (
  filters: CommentFilters,
  overrides: Partial<
    Pick<CommentFilters, "reportStatus" | "reportToken" | "token">
  > = {}
) =>
  buildQueryString({
    episode: filters.episode,
    report_status: overrides.reportStatus ?? filters.reportStatus,
    report_token: overrides.reportToken ?? filters.reportToken,
    series: filters.series,
    status: filters.status,
    token: overrides.token ?? filters.token,
  });

/**
 * Switching the report state drops that queue's own cursor: a token names a
 * row in the page it was issued for, so it means nothing once the state being
 * filtered has changed. The comment list keeps its own.
 */
const reportStatusOptions = (
  filters: CommentFilters
): CommentReportStatusOption[] =>
  ["" as const, ...COMMENT_REPORT_STATUSES].map((status) => ({
    href:
      commentScreenQuery(filters, { reportStatus: status, reportToken: "" }) ||
      "?",
    status,
  }));

const CommentsContent = async ({
  searchParams,
}: Pick<CommentsPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const filters = parseCommentFilters(sp);
  const locale = await getLocale(tenantId);

  const [listResult, reportResult, timeZone] = await Promise.all([
    listComments(tenantId, locale, {
      episodePublicId: filters.episode,
      limit: DEFAULT_PAGE_SIZE,
      seriesPublicId: filters.series,
      status: filters.status,
      token: filters.token,
    }),
    listCommentReports(tenantId, locale, {
      limit: DEFAULT_PAGE_SIZE,
      status: filters.reportStatus,
      token: filters.reportToken,
    }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(listResult);
  await redirectToLoginIfSessionRejected(reportResult);

  return (
    <div className="grid gap-6">
      {/*
        The reports come first because they are the work that arrived from
        outside the console: a reader flagged something, and nobody has looked
        at it yet.
      */}
      <CommentReportQueue
        listErrorMessage={reportResult.ok ? undefined : reportResult.message}
        locale={locale}
        nextHref={
          reportResult.nextToken
            ? commentScreenQuery(filters, {
                reportToken: reportResult.nextToken,
              })
            : undefined
        }
        pageSize={DEFAULT_PAGE_SIZE}
        previousHref={
          reportResult.previousToken
            ? commentScreenQuery(filters, {
                reportToken: reportResult.previousToken,
              })
            : undefined
        }
        reports={reportResult.reports}
        status={filters.reportStatus}
        statusOptions={reportStatusOptions(filters)}
        timeZone={timeZone}
      />
      <CommentFilterForm
        filters={filters}
        locale={locale}
        timeZone={timeZone}
      />
      <CommentManager
        comments={listResult.comments}
        listErrorMessage={listResult.ok ? undefined : listResult.message}
        locale={locale}
        nextHref={
          listResult.nextToken
            ? commentScreenQuery(filters, { token: listResult.nextToken })
            : undefined
        }
        pageSize={DEFAULT_PAGE_SIZE}
        previousHref={
          listResult.previousToken
            ? commentScreenQuery(filters, { token: listResult.previousToken })
            : undefined
        }
        timeZone={timeZone}
      />
    </div>
  );
};

const CommentsPage = ({ searchParams }: CommentsPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
            <Message message="admin.comments.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.comments.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.comments.list_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<CommentsSkeleton />}>
          <CommentsContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </AdminPageContent>
  </AdminPage>
);

export default CommentsPage;
