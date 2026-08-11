import { LinkButton } from "@publira/ui-components/button";
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
import { FlashToast } from "#components/flash-toast";
import { listEpisodeImages } from "#lib/episode";
import { getTenantId } from "#lib/tenant-id";

import { EpisodeImagesSortableGrid } from "./_components/episode-images-sortable-grid";
import { EpisodePagesForm } from "./_components/episode-pages-form";
import { EpisodeScheduleForm } from "./_components/episode-schedule-form";
import {
  reorderEpisodeImagesAction,
  updateEpisodeScheduleAction,
  uploadEpisodePagesAction,
} from "./_lib/actions";

export const metadata: Metadata = {
  title: "エピソード編集",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id", "episode_id");

const EditEpisodePage = async ({
  params,
}: PageProps<"/[tenant_id]/series/[series_id]/episodes/[episode_id]">) => {
  const [{ episode_id, series_id }, tenantId] = await Promise.all([
    params,
    getTenantId(),
  ]);
  guardPlaceholder(series_id);
  guardPlaceholder(episode_id);

  const imagesResult = await listEpisodeImages({
    episodePublicId: episode_id,
    tenantId,
  });

  return (
    <AdminPage>
      <AdminPageHeader>
        <AdminPageHeading>
          <AdminPageEyebrow>{`Series ${series_id} / Episode ${episode_id}`}</AdminPageEyebrow>
          <AdminPageTitle>エピソード編集</AdminPageTitle>
          <AdminPageDescription>
            エピソードの公開設定とページ画像を編集します。
          </AdminPageDescription>
        </AdminPageHeading>
        <AdminPageActions>
          <div className="flex gap-2">
            <LinkButton
              render={<Link href={`/series/${series_id}/episodes`} />}
              variant="outline"
            >
              一覧へ戻る
            </LinkButton>
            <LinkButton
              render={<Link href={`/series/${series_id}/episodes/new`} />}
              variant="outline"
            >
              新規作成
            </LinkButton>
          </div>
        </AdminPageActions>
      </AdminPageHeader>
      <AdminPageContent>
        <FlashToast keyName="created" title="エピソードを作成しました。" />
        <FlashToast
          keyName="schedule_updated"
          title="publish_at を更新しました。"
        />
        <FlashToast
          keyName="pages_uploaded"
          title="ページ画像を追加しました。"
        />
        <FlashToast
          keyName="images_reordered"
          title="ページ画像の表示順を更新しました。"
        />
        <FlashToast
          keyName="image_reorder_error"
          title="ページ画像の表示順更新に失敗しました。"
        />

        <div className="grid gap-6">
          <EpisodeScheduleForm
            action={updateEpisodeScheduleAction}
            episodePublicId={episode_id}
            seriesPublicId={series_id}
          />
          <EpisodePagesForm
            action={uploadEpisodePagesAction}
            episodePublicId={episode_id}
            seriesPublicId={series_id}
          />

          <section className="grid gap-3 rounded-lg border border-border/70 p-4">
            <h2 className="text-sm font-medium">登録済みページ画像</h2>
            <p className="text-xs text-muted-foreground">
              画像はドラッグ＆ドロップで並び替えできます。
            </p>

            {/*
              A failed read hands back an empty `images`, so 「まだ登録されて
              いません」 has to stay behind `imagesResult.ok`; otherwise the
              section says the images are missing and that they were never
              uploaded, in the same breath.
            */}
            {imagesResult.ok ? null : (
              <SectionError
                description={imagesResult.message}
                title="ページ画像を表示できませんでした"
              />
            )}

            {imagesResult.ok && imagesResult.images.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                ページ画像はまだ登録されていません。
              </p>
            ) : null}

            {imagesResult.images.length > 0 ? (
              <EpisodeImagesSortableGrid
                episodePublicId={episode_id}
                images={imagesResult.images}
                reorderAction={reorderEpisodeImagesAction}
                seriesPublicId={series_id}
              />
            ) : null}
          </section>
        </div>
      </AdminPageContent>
    </AdminPage>
  );
};

export default EditEpisodePage;
