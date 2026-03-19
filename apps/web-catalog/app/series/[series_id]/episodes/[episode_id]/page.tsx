export const generateStaticParams = () =>
  Promise.resolve([{ episode_id: "1", series_id: "1" }]);

export default async function Page({
  params,
}: PageProps<"/series/[series_id]/episodes/[episode_id]">) {
  const { series_id, episode_id } = await params;
  return (
    <main>
      web-catalog /series/{series_id}/episodes/{episode_id}: {series_id}/
      {episode_id}
    </main>
  );
}
