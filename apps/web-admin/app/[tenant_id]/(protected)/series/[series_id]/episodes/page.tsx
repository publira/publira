import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { SectionError } from "@publira/ui-components/section-error";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";

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
import { PaginationFooter } from "#components/pagination-controls";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  hasCursorPageLinks,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { listEpisodes } from "#lib/episode";
import { getTenantId } from "#lib/tenant-id";

import { EpisodesSortableList } from "./_components/episodes-sortable-list";
import { reorderEpisodesAction } from "./_lib/actions";

export const metadata: Metadata = {
  title: "エピソード",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id");

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
  const result = await listEpisodes({
    seriesPublicId: series_id,
    tenantId,
    token,
  });
  const pageHrefs = cursorPageHrefs(result);
  const hasPageLinks = hasCursorPageLinks(pageHrefs);

  return (
    <AdminPage>
      <AdminPageHeader>
        <AdminPageHeading>
          <AdminPageEyebrow>{`Series ${series_id}`}</AdminPageEyebrow>
          <AdminPageTitle>エピソード一覧</AdminPageTitle>
          <AdminPageDescription>
            シリーズ配下のエピソードを管理します。
          </AdminPageDescription>
        </AdminPageHeading>
        <AdminPageActions>
          <div className="flex gap-2">
            <LinkButton
              render={<Link href={`/series/${series_id}/episodes/new`} />}
            >
              新規作成
            </LinkButton>
            <LinkButton
              render={<Link href={`/series/${series_id}`} />}
              variant="outline"
            >
              シリーズへ戻る
            </LinkButton>
          </div>
        </AdminPageActions>
      </AdminPageHeader>
      <AdminPageContent>
        <FlashToast
          keyName="reordered"
          title="エピソードの表示順を更新しました。"
        />
        <FlashToast
          keyName="reorder_error"
          title="エピソードの表示順更新に失敗しました。"
        />

        <Card>
          <CardHeader>
            <CardTitle>エピソード管理</CardTitle>
            <CardDescription>
              一覧・新規作成・個別編集の導線をこの配下に集約しています。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {result.ok ? null : (
              <SectionError
                description={result.message}
                title="エピソード一覧を表示できませんでした"
              />
            )}

            {result.episodes.length === 0 ? (
              <CursorPageEmptyState
                actions={
                  <LinkButton
                    render={<Link href={`/series/${series_id}/episodes/new`} />}
                  >
                    エピソードを新規作成
                  </LinkButton>
                }
                description="まだエピソードがありません。まずは新規作成してください。"
                hasPageLinks={hasPageLinks}
                itemLabel="エピソード"
                title="このシリーズのエピソードは未登録です。"
              />
            ) : (
              <div className="grid gap-3">
                <p className="text-xs text-muted-foreground">
                  エピソードはカードをドラッグ＆ドロップして並び替えできます。
                  {hasPageLinks
                    ? "並び替えはこのページ内で行えます。ページをまたぐ移動はできません。"
                    : null}
                </p>
                <EpisodesSortableList
                  episodes={result.episodes}
                  reorderAction={reorderEpisodesAction}
                  seriesPublicId={series_id}
                />
              </div>
            )}

            {result.episodes.length > 0 || hasPageLinks ? (
              <PaginationFooter
                {...pageHrefs}
                ariaLabel="エピソード一覧のページ送り"
                description={`表示順に、1ページあたり ${DEFAULT_PAGE_SIZE} 件まで表示します。`}
              />
            ) : null}
          </CardContent>
        </Card>
      </AdminPageContent>
    </AdminPage>
  );
};

export default SeriesEpisodesPage;
