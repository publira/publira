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
import { listComments } from "#lib/comment";
import { DEFAULT_PAGE_SIZE } from "#lib/cursor-page";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { buildQueryString } from "#lib/query-string";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { CommentFilterForm } from "./_components/comment-filter-form";
import { CommentManager } from "./_components/comment-manager";
import { parseCommentFilters } from "./_lib/search-params";
import type { CommentFilters } from "./_lib/search-params";

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

/** Query-only href that keeps the filters while the operator walks the pages. */
const commentFilterQuery = (filters: CommentFilters, token?: string) =>
  buildQueryString({
    episode: filters.episode,
    series: filters.series,
    status: filters.status,
    token,
  });

const CommentsContent = async ({
  searchParams,
}: Pick<CommentsPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const filters = parseCommentFilters(sp);
  const locale = await getLocale(tenantId);

  const [listResult, timeZone] = await Promise.all([
    listComments(tenantId, locale, {
      episodePublicId: filters.episode,
      limit: DEFAULT_PAGE_SIZE,
      seriesPublicId: filters.series,
      status: filters.status,
      token: filters.token,
    }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(listResult);

  return (
    <div className="grid gap-6">
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
            ? commentFilterQuery(filters, listResult.nextToken)
            : undefined
        }
        pageSize={DEFAULT_PAGE_SIZE}
        previousHref={
          listResult.previousToken
            ? commentFilterQuery(filters, listResult.previousToken)
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
