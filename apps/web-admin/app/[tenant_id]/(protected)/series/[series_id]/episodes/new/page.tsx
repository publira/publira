import { LinkButton } from "@publira/ui-components/button";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";

import { AdminPage } from "#components/admin-page";

import { EpisodeForm } from "../_components/episode-form";
import { createEpisodeAction } from "../_lib/actions";

export const metadata: Metadata = {
  title: "エピソード新規作成",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id");

const NewEpisodePage = async ({
  params,
}: PageProps<"/[tenant_id]/series/[series_id]/episodes/new">) => {
  const { series_id } = await params;
  guardPlaceholder(series_id);

  return (
    <AdminPage
      actions={
        <div className="flex gap-2">
          <LinkButton
            render={<Link href={`/series/${series_id}/episodes`} />}
            variant="outline"
          >
            一覧へ戻る
          </LinkButton>
          <LinkButton
            render={<Link href={`/series/${series_id}`} />}
            variant="outline"
          >
            シリーズへ戻る
          </LinkButton>
        </div>
      }
      description="シリーズ配下に新しいエピソードを登録します。"
      eyebrow={`Series ${series_id}`}
      title="エピソード新規作成"
    >
      <EpisodeForm action={createEpisodeAction} seriesPublicId={series_id} />
    </AdminPage>
  );
};

export default NewEpisodePage;
