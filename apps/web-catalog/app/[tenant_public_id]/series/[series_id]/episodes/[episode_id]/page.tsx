import {
  createPlaceholderStaticParams,
  guardPlaceholders,
} from "@publira/utils/next-static-params";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id", "series_id", "episode_id");

export default async function Page({
  params,
}: PageProps<"/[tenant_public_id]/series/[series_id]/episodes/[episode_id]">) {
  const { series_id, episode_id, tenant_public_id } = await params;

  guardPlaceholders({ episode_id, series_id, tenant_public_id });

  return (
    <main>
      web-catalog /series/{series_id}/episodes/{episode_id}: {series_id}/
      {episode_id}
    </main>
  );
}
