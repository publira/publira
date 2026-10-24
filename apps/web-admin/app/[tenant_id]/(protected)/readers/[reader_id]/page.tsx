import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { LinkButton } from "@publira/ui-components/button";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { z } from "zod";

import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import { listAccessTickets } from "#lib/access-ticket";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { listComments } from "#lib/comment";
import { DEFAULT_PAGE_SIZE } from "#lib/cursor-page";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { listPaymentProviders } from "#lib/payment-settings";
import { listReaderPurchases } from "#lib/purchase";
import { getReader } from "#lib/reader";
import { listAllSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { ReaderAccount } from "./_components/reader-account";
import { ReaderComments } from "./_components/reader-comments";
import { ReaderPurchases } from "./_components/reader-purchases";
import { ReaderTickets } from "./_components/reader-tickets";
import { isOwnAccount } from "./_lib/own-account";
import { parseReaderPageCursors, readerPageHref } from "./_lib/search-params";

type ReaderDetailPageProps = PageProps<"/[tenant_id]/readers/[reader_id]">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);
  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.readers.detail_title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "reader_id");

const readerParamsSchema = z.object({
  reader_id: routeParamString(),
});

/**
 * The reader the page is about. Every section but the comments addresses the
 * reader by primary key, which only this read answers, so it is made once per
 * request however many sections await it.
 */
const getPageReader = cache(getReader);

const AccountSkeleton = () => (
  <ConsoleSection.Root>
    <SkeletonLine className="h-5 w-24" />
    <Skeleton className="h-64" />
  </ConsoleSection.Root>
);

const ListSectionSkeleton = () => (
  <ConsoleSection.Root>
    <SkeletonLine className="h-5 w-24" />
    <Table.Skeleton />
  </ConsoleSection.Root>
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
    getPageReader(tenantId, locale, parsedParams.reader_id),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok) {
    if (result.notFound) {
      // Missing or another tenant's reader — never told apart. Renders
      // `(protected)/not-found.tsx` inside the console chrome.
      notFound();
    }

    await redirectToLoginIfSessionRejected(result);

    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.readers.detail_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
        <SectionError.Actions>
          <LinkButton render={<Link href="/readers" />} variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.readers.back_to_list" />
            </Suspense>
          </LinkButton>
        </SectionError.Actions>
      </SectionError.Root>
    );
  }

  const ownAccount = await isOwnAccount(tenantId, result.reader.publicId);

  return (
    <ReaderAccount
      locale={locale}
      reader={result.reader}
      ownAccount={ownAccount}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const ReaderPurchasesContent = async ({
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
  const cursors = parseReaderPageCursors(sp);
  const locale = await getLocale(tenantId);
  const [readerResult, timeZone, providersResult] = await Promise.all([
    getPageReader(tenantId, locale, parsedParams.reader_id),
    getTenantDisplayTimeZone(tenantId),
    listPaymentProviders(tenantId, locale),
  ]);
  if (!readerResult.ok && readerResult.notFound) {
    notFound();
  }
  const result = readerResult.ok
    ? await listReaderPurchases(tenantId, locale, readerResult.reader.id, {
        limit: DEFAULT_PAGE_SIZE,
        token: cursors.purchases_token,
      })
    : undefined;

  await redirectToLoginIfSessionRejected(
    readerResult,
    providersResult,
    ...(result ? [result] : [])
  );

  let listErrorMessage: string | undefined;
  if (!readerResult.ok) {
    listErrorMessage = readerResult.message;
  } else if (result && !result.ok) {
    listErrorMessage = result.message;
  }

  // Without the providers' names a purchase still says which one it was paid
  // through, by the id the server stores.
  const providerNames: ReadonlyMap<string, string> = new Map(
    providersResult.ok
      ? providersResult.providers.map((provider) => [
          provider.id,
          provider.displayName,
        ])
      : []
  );

  return (
    <ReaderPurchases
      listErrorMessage={listErrorMessage}
      locale={locale}
      nextHref={
        result?.nextToken
          ? readerPageHref(cursors, { purchases_token: result.nextToken })
          : undefined
      }
      now={Temporal.Now.instant()}
      pageSize={DEFAULT_PAGE_SIZE}
      previousHref={
        result?.previousToken
          ? readerPageHref(cursors, { purchases_token: result.previousToken })
          : undefined
      }
      providerNames={providerNames}
      purchases={result?.purchases ?? []}
      timeZone={timeZone}
    />
  );
};

const ReaderTicketsContent = async ({
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
  const cursors = parseReaderPageCursors(sp);
  const locale = await getLocale(tenantId);
  const [readerResult, result, timeZone, seriesResult] = await Promise.all([
    getPageReader(tenantId, locale, parsedParams.reader_id),
    listAccessTickets(tenantId, locale, {
      limit: DEFAULT_PAGE_SIZE,
      token: cursors.tickets_token,
      userPublicId: parsedParams.reader_id,
    }),
    getTenantDisplayTimeZone(tenantId),
    listAllSeries(),
  ]);
  if (!readerResult.ok && readerResult.notFound) {
    notFound();
  }

  await redirectToLoginIfSessionRejected(readerResult, result);

  // The list is filtered by the public ID the URL carries, but a ticket is
  // issued to the primary key only the reader read answers, so without that
  // read the list stands and nothing can be issued from it.
  return (
    <ReaderTickets
      listErrorMessage={result.ok ? undefined : result.message}
      locale={locale}
      name={
        readerResult.ok
          ? readerResult.reader.name || readerResult.reader.email
          : parsedParams.reader_id
      }
      nextHref={
        result.nextToken
          ? readerPageHref(cursors, { tickets_token: result.nextToken })
          : undefined
      }
      pageSize={DEFAULT_PAGE_SIZE}
      previousHref={
        result.previousToken
          ? readerPageHref(cursors, { tickets_token: result.previousToken })
          : undefined
      }
      readerId={readerResult.ok ? readerResult.reader.id : undefined}
      series={seriesResult.series.map((item) => ({
        id: item.id,
        publicId: item.publicId,
        title: item.title,
      }))}
      seriesErrorMessage={seriesResult.ok ? undefined : seriesResult.message}
      tenantId={tenantId}
      tickets={result.tickets}
      timeZone={timeZone}
    />
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
  const cursors = parseReaderPageCursors(sp);
  const locale = await getLocale(tenantId);

  const [result, timeZone] = await Promise.all([
    listComments(tenantId, locale, {
      authorPublicId: parsedParams.reader_id,
      limit: DEFAULT_PAGE_SIZE,
      token: cursors.token,
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
          ? readerPageHref(cursors, { token: result.nextToken })
          : undefined
      }
      pageSize={DEFAULT_PAGE_SIZE}
      previousHref={
        result.previousToken
          ? readerPageHref(cursors, { token: result.previousToken })
          : undefined
      }
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const ReaderDetailPage = ({ params, searchParams }: ReaderDetailPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
                <Message message="admin.readers.detail_title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.readers.detail_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
          <ConsolePage.Actions>
            <LinkButton render={<Link href="/readers" />} variant="outline">
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.readers.back_to_list" />
              </Suspense>
            </LinkButton>
          </ConsolePage.Actions>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <FlashToast keyName="suspended" message="admin.readers.suspended" />
          <FlashToast
            keyName="unsuspended"
            message="admin.readers.unsuspended"
          />
          <FlashToast
            keyName="birth_date_updated"
            message="admin.readers.birth_date_updated"
          />
          <FlashToast
            keyName="icon_removed"
            message="admin.readers.icon_removed"
          />
          <ConsoleSection.Stack>
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
                  <Message message="admin.readers.purchases_error" />
                </Suspense>
              }
            >
              <Suspense fallback={<ListSectionSkeleton />}>
                <ReaderPurchasesContent
                  params={params}
                  searchParams={searchParams}
                />
              </Suspense>
            </SectionErrorBoundary>
            <SectionErrorBoundary
              title={
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.readers.tickets_error" />
                </Suspense>
              }
            >
              <Suspense fallback={<ListSectionSkeleton />}>
                <ReaderTicketsContent
                  params={params}
                  searchParams={searchParams}
                />
              </Suspense>
            </SectionErrorBoundary>
            <SectionErrorBoundary
              title={
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="admin.readers.comments_error" />
                </Suspense>
              }
            >
              <Suspense fallback={<ListSectionSkeleton />}>
                <ReaderCommentsContent
                  params={params}
                  searchParams={searchParams}
                />
              </Suspense>
            </SectionErrorBoundary>
          </ConsoleSection.Stack>
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default ReaderDetailPage;
