import {
  createPlaceholderStaticParams,
  guardPlaceholders,
} from "@publira/utils/next-static-params";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id", "author_id");

export default async function Page({
  params,
}: PageProps<"/[tenant_public_id]/authors/[author_id]">) {
  const { author_id, tenant_public_id } = await params;

  guardPlaceholders({ author_id, tenant_public_id });

  return (
    <main>
      web-catalog /authors/{author_id}: {author_id}
    </main>
  );
}
