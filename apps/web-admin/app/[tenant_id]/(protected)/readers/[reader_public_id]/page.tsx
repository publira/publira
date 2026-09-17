import { LinkButton } from "@publira/ui-components/button";
import {
  SectionError,
  SectionErrorActions,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { TableSkeleton } from "@publira/ui-components/table";
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
  AdminSections,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { listComments } from "#lib/comment";
import { cursorTokenSchema, DEFAULT_PAGE_SIZE } from "#lib/cursor-page";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { buildQueryString } from "#lib/query-string";
import { getReader } from "#lib/reader";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { ReaderAccount } from "./_components/reader-account";
import { ReaderComments } from "./_components/reader-comments";

type ReaderDetailPageProps =
  PageProps<"/[tenant_id]/readers/[reader_public_id]">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.readers.detail_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "reader_public_id");

const readerParamsSchema = z.object({
  reader_public_id: routeParamString(),
});

const commentSearchParamsSchema = z.object({
  token: cursorTokenSchema,
});

const AccountSkeleton = () => (
  <AdminSection>
    <SkeletonLine className="h-5 w-24" />
    <Skeleton className="h-64" />
  </AdminSection>
);

const CommentsSkeleton = () => (
  <AdminSection>
    <SkeletonLine className="h-5 w-24" />
    <TableSkeleton />
  </AdminSection>
);

const ReaderAccountContent = async ({
  params,
}: Pick<ReaderDetailPageProps, "params">) => {
  const parsedParams = parseRouteParams(readerParamsSchema, await params);
  if (!parsedParams) {
    notFound();
  }
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const [result, timeZone] = await Promise.all([
    getReader(tenantId, locale, parsedParams.reader_public_id),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok) {
    if (result.notFound) {
      // Missing, a staff account, or another tenant's reader — never told
      // apart. Renders `(protected)/not-found.tsx` inside the console chrome.
      notFound();
    }

    await redirectToLoginIfSessionRejected(result);

    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.readers.detail_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
        <SectionErrorActions>
          <LinkButton render={<Link href="/readers" />} variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.readers.back_to_list" />
            </Suspense>
          </LinkButton>
        </SectionErrorActions>
      </SectionError>
    );
  }

  return (
    <ReaderAccount locale={locale} reader={result.reader} timeZone={timeZone} />
  );
};

const ReaderCommentsContent = async ({
  params,
  searchParams,
}: Pick<ReaderDetailPageProps, "params" | "searchParams">) => {
  const [rawParams, sp, tenantId] = await Promise.all([
    params,
    searchParams,
    getTenantId(),
  ]);
  const parsedParams = parseRouteParams(readerParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { token } = commentSearchParamsSchema.parse(sp);
  const locale = await getLocale(tenantId);

  const [result, timeZone] = await Promise.all([
    listComments(tenantId, locale, {
      authorPublicId: parsedParams.reader_public_id,
      limit: DEFAULT_PAGE_SIZE,
      token,
    }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(result);

  return (
    <ReaderComments
      comments={result.comments}
      listErrorMessage={result.ok ? undefined : result.message}
      locale={locale}
      nextHref={
        result.nextToken
          ? buildQueryString({ token: result.nextToken })
          : undefined
      }
      pageSize={DEFAULT_PAGE_SIZE}
      previousHref={
        result.previousToken
          ? buildQueryString({ token: result.previousToken })
          : undefined
      }
      timeZone={timeZone}
    />
  );
};

const ReaderDetailPage = ({ params, searchParams }: ReaderDetailPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
            <Message message="admin.readers.detail_title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.readers.detail_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/readers" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.readers.back_to_list" />
          </Suspense>
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <AdminSections>
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.readers.detail_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<AccountSkeleton />}>
            <ReaderAccountContent params={params} />
          </Suspense>
        </SectionErrorBoundary>
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.readers.comments_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<CommentsSkeleton />}>
            <ReaderCommentsContent
              params={params}
              searchParams={searchParams}
            />
          </Suspense>
        </SectionErrorBoundary>
      </AdminSections>
    </AdminPageContent>
  </AdminPage>
);

export default ReaderDetailPage;
