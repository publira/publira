import { getMessage } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { SectionError } from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
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
  AdminPageDescription,
  AdminPageEyebrow,
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
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { EpisodesSortableList } from "./_components/episodes-sortable-list";
import { reorderEpisodesAction } from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.series.episodes.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id");

const SeriesEpisodesPageSkeleton = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Series</AdminPageEyebrow>
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
        </div>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="rounded-2xl border border-border/70 bg-card p-6">
        <div className="grid gap-4">
          <SkeletonLine className="h-6 w-48" />
          <SkeletonLine className="h-4 w-72" />
          <div className="h-16 animate-pulse rounded bg-muted/70" />
          <div className="h-16 animate-pulse rounded bg-muted/70" />
        </div>
      </div>
    </AdminPageContent>
  </AdminPage>
);

const SeriesEpisodesPage = async ({
  params,
  searchParams,
}: PageProps<"/[tenant_id]/series/[series_id]/episodes">) => {
  const [{ series_id }, sp, tenantId] = await Promise.all([
    params,
    searchParams,
    getTenantId(),
  ]);
  guardPlaceholder(series_id);

  const { token } = parseCursorSearchParams(sp);
  const locale = await getLocale(tenantId);
  const [result, timeZone, messages] = await Promise.all([
    listEpisodes(
      {
        seriesPublicId: series_id,
        tenantId,
        token,
      },
      locale
    ),
    getTenantDisplayTimeZone(tenantId),
    loadAdminMessages(locale),
  ]);
  await redirectToLoginIfSessionRejected(result);

  const pageHrefs = cursorPageHrefs(result);
  const hasPageLinks = hasCursorPageLinks(pageHrefs);

  return (
    <Suspense fallback={<SeriesEpisodesPageSkeleton />}>
      <AdminPage>
        <AdminPageHeader>
          <AdminPageHeading>
            <AdminPageEyebrow>{`Series ${series_id}`}</AdminPageEyebrow>
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
              <LinkButton
                render={<Link href={`/series/${series_id}`} />}
                variant="outline"
              >
                <Message message="admin.series.episodes.back_to_series" />
              </LinkButton>
            </div>
          </AdminPageActions>
        </AdminPageHeader>
        <AdminPageContent>
          <FlashToast
            keyName="reordered"
            title={getMessage(messages, "admin.series.episodes.reordered")}
          />
          <FlashToast
            keyName="reorder_error"
            title={getMessage(messages, "admin.series.episodes.reorder_error")}
          />

          <Card>
            <CardHeader>
              <CardTitle>
                <Message message="admin.series.episodes.manage_title" />
              </CardTitle>
              <CardDescription>
                <Message message="admin.series.episodes.manage_description" />
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {/*
              A failed read hands back an empty `episodes`, so the empty state
              has to stay behind `result.ok`. Otherwise the card says the list
              could not be displayed and that nothing is registered at once, and
              offers a create button for a list nobody managed to read.
            */}
              {result.ok ? (
                <>
                  {result.episodes.length === 0 ? (
                    <CursorPageEmptyState
                      actions={
                        <LinkButton
                          render={
                            <Link href={`/series/${series_id}/episodes/new`} />
                          }
                        >
                          <Message message="admin.series.episodes.create_action" />
                        </LinkButton>
                      }
                      description={
                        <Message message="admin.series.episodes.empty_description" />
                      }
                      hasPageLinks={hasPageLinks}
                      itemLabel={getMessage(
                        messages,
                        "admin.series.episodes.title"
                      )}
                      title={getMessage(
                        messages,
                        "admin.series.episodes.empty_title"
                      )}
                    />
                  ) : (
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
                  )}

                  {result.episodes.length > 0 || hasPageLinks ? (
                    <PaginationFooter
                      {...pageHrefs}
                      ariaLabel={getMessage(
                        messages,
                        "admin.series.episodes.pagination_aria"
                      )}
                      description={getMessage(
                        messages,
                        "admin.series.episodes.pagination_description",
                        { count: DEFAULT_PAGE_SIZE }
                      )}
                    />
                  ) : null}
                </>
              ) : (
                <SectionError
                  description={result.message}
                  title={<Message message="admin.series.episodes.list_error" />}
                />
              )}
            </CardContent>
          </Card>
        </AdminPageContent>
      </AdminPage>
    </Suspense>
  );
};

export default SeriesEpisodesPage;
