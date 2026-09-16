import { LinkButton } from "@publira/ui-components/button";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageContext,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { PaginationFooter } from "#components/pagination-controls";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  hasCursorPageLinks,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { listEpisodes } from "#lib/episode";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { EpisodeCreditsRangeDialog } from "./_components/episode-credits-range-dialog";
import { EpisodesSortableList } from "./_components/episodes-sortable-list";
import { reorderEpisodesAction } from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.series.episodes.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id");

type SeriesEpisodesPageProps =
  PageProps<"/[tenant_id]/series/[series_id]/episodes">;

const SeriesEpisodesHeaderSkeleton = () => (
  <>
    <AdminPageHeading>
      <AdminPageContext>
        <SkeletonLine className="h-4 w-40" />
      </AdminPageContext>
      <AdminPageTitle>
        <SkeletonLine className="h-7 w-48" />
      </AdminPageTitle>
      <AdminPageDescription>
        <SkeletonLine className="h-4 w-72" />
      </AdminPageDescription>
    </AdminPageHeading>
    <AdminPageActions>
      <div className="flex gap-2">
        <SkeletonLine className="h-10 w-28" />
        <SkeletonLine className="h-10 w-28" />
        <SkeletonLine className="h-10 w-28" />
      </div>
    </AdminPageActions>
  </>
);

const SeriesEpisodesListSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-6 w-48" />
    <SkeletonLine className="h-4 w-72" />
    <Skeleton className="h-16" />
    <Skeleton className="h-16" />
  </div>
);

const SeriesEpisodesChrome = async ({
  params,
}: Pick<SeriesEpisodesPageProps, "params">) => {
  const { series_id } = await params;
  guardPlaceholder(series_id);

  return (
    <>
      <AdminPageHeading>
        <AdminPageContext>{`Series ${series_id}`}</AdminPageContext>
        <AdminPageTitle>
          <Message message="admin.series.episodes.list_title" />
        </AdminPageTitle>
        <AdminPageDescription>
          <Message message="admin.series.episodes.list_description" />
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <div className="flex gap-2">
          <LinkButton
            render={<Link href={`/series/${series_id}/episodes/new`} />}
          >
            <Message message="admin.series.episodes.new_action" />
          </LinkButton>
          <EpisodeCreditsRangeDialog seriesPublicId={series_id} />
          <LinkButton
            render={<Link href={`/series/${series_id}`} />}
            variant="outline"
          >
            <Message message="admin.series.episodes.back_to_series" />
          </LinkButton>
        </div>
      </AdminPageActions>
    </>
  );
};

const SeriesEpisodesData = async ({
  params,
  searchParams,
}: SeriesEpisodesPageProps) => {
  const [{ series_id }, sp, tenantId] = await Promise.all([
    params,
    searchParams,
    getTenantId(),
  ]);
  guardPlaceholder(series_id);

  const { token } = parseCursorSearchParams(sp);
  const locale = await getLocale(tenantId);
  const [result, timeZone, t] = await Promise.all([
    listEpisodes(
      {
        seriesPublicId: series_id,
        tenantId,
        token,
      },
      locale
    ),
    getTenantDisplayTimeZone(tenantId),
    getMessagesFor(locale),
  ]);
  await redirectToLoginIfSessionRejected(result);

  const pageHrefs = cursorPageHrefs(result);
  const hasPageLinks = hasCursorPageLinks(pageHrefs);

  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Message message="admin.series.episodes.list_error" />
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (result.episodes.length === 0) {
    return (
      <>
        <CursorPageEmptyState
          actions={
            <LinkButton
              render={<Link href={`/series/${series_id}/episodes/new`} />}
            >
              <Message message="admin.series.episodes.create_action" />
            </LinkButton>
          }
          description={
            <Message message="admin.series.episodes.empty_description" />
          }
          hasPageLinks={hasPageLinks}
          itemLabel={t("admin.series.episodes.title")}
          title={t("admin.series.episodes.empty_title")}
        />
        {hasPageLinks ? (
          <PaginationFooter
            {...pageHrefs}
            ariaLabel={t("admin.series.episodes.pagination_aria")}
            description={t("admin.series.episodes.pagination_description", {
              count: DEFAULT_PAGE_SIZE,
            })}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="grid gap-3">
        <p className="text-xs text-muted-foreground">
          <Message message="admin.series.episodes.drag_description" />
          {hasPageLinks ? (
            <Message message="admin.series.episodes.drag_page_description" />
          ) : null}
        </p>
        <EpisodesSortableList
          episodes={result.episodes}
          reorderAction={reorderEpisodesAction}
          seriesPublicId={series_id}
          timeZone={timeZone}
        />
      </div>
      <PaginationFooter
        {...pageHrefs}
        ariaLabel={t("admin.series.episodes.pagination_aria")}
        description={t("admin.series.episodes.pagination_description", {
          count: DEFAULT_PAGE_SIZE,
        })}
      />
    </>
  );
};

const SeriesEpisodesPage = ({
  params,
  searchParams,
}: SeriesEpisodesPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <Suspense fallback={<SeriesEpisodesHeaderSkeleton />}>
        <SeriesEpisodesChrome params={params} />
      </Suspense>
    </AdminPageHeader>
    <AdminPageContent>
      <FlashToast
        keyName="reordered"
        message="admin.series.episodes.reordered"
      />
      <FlashToast
        keyName="reorder_error"
        message="admin.series.episodes.reorder_error"
      />
      {/*
        A failed read hands back an empty `episodes`, so the empty state
        has to stay behind `result.ok`. Otherwise the screen says the list
        could not be displayed and that nothing is registered at once, and
        offers a create button for a list nobody managed to read.
      */}
      <Suspense fallback={<SeriesEpisodesListSkeleton />}>
        <SeriesEpisodesData params={params} searchParams={searchParams} />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default SeriesEpisodesPage;
