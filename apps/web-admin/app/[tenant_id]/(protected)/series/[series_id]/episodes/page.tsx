import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { EmptyState } from "@publira/ui-components/empty-state";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";

import { AdminPage } from "#components/admin-page";
import { FlashToast } from "#components/flash-toast";
import { listEpisodes } from "#lib/episode";
import { getTenantId } from "#lib/tenant-id";

import { EpisodesSortableList } from "./_components/episodes-sortable-list";
import { reorderEpisodesAction } from "./_lib/actions";

export const metadata: Metadata = {
  title: "エピソード",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id");

export default async function SeriesEpisodesPage({
  params,
}: PageProps<"/[tenant_id]/series/[series_id]/episodes">) {
  const { series_id } = await params;
  const tenantId = await getTenantId();
  guardPlaceholder(series_id);

  const result = await listEpisodes({
    seriesPublicId: series_id,
    tenantId,
  });

  return (
    <AdminPage
      actions={
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
      }
      description="シリーズ配下のエピソードを管理します。"
      eyebrow={`Series ${series_id}`}
      title="エピソード一覧"
    >
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
        <CardContent>
          {result.ok ? null : (
            <FormMessage variant="destructive">{result.message}</FormMessage>
          )}

          {result.episodes.length === 0 ? (
            <EmptyState
              actions={
                <LinkButton
                  render={<Link href={`/series/${series_id}/episodes/new`} />}
                >
                  エピソードを新規作成
                </LinkButton>
              }
              description="まだエピソードがありません。まずは新規作成してください。"
              title="このシリーズのエピソードは未登録です。"
            />
          ) : (
            <div className="grid gap-3">
              <p className="text-xs text-muted-foreground">
                エピソードはカードをドラッグ＆ドロップして並び替えできます。
              </p>
              <EpisodesSortableList
                episodes={result.episodes}
                reorderAction={reorderEpisodesAction}
                seriesPublicId={series_id}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
}
