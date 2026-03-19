export const generateStaticParams = () => Promise.resolve([{ series_id: "1" }]);

export default async function Page({
  params,
}: PageProps<"/series/[series_id]">) {
  const { series_id } = await params;
  return (
    <main>
      web-catalog /series/{series_id}: {series_id}
    </main>
  );
}
