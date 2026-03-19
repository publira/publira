export const generateStaticParams = () => Promise.resolve([{ author_id: "1" }]);

export default async function Page({
  params,
}: PageProps<"/authors/[author_id]">) {
  const { author_id } = await params;
  return (
    <main>
      web-catalog /authors/{author_id}: {author_id}
    </main>
  );
}
