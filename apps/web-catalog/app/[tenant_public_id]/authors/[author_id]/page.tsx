import {
  createPlaceholderStaticParams,
  guardPlaceholders,
} from "@publira/utils/next-static-params";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getPublishedAuthorDetail } from "../../../../lib/authors";
import { getTenantSiteLabel } from "../../../../lib/tenant";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id", "author_id");

export default async function Page({
  params,
}: PageProps<"/[tenant_public_id]/authors/[author_id]">) {
  const { author_id, tenant_public_id } = await params;

  guardPlaceholders({ author_id, tenant_public_id });

  const [siteLabel, author] = await Promise.all([
    getTenantSiteLabel(tenant_public_id),
    getPublishedAuthorDetail(tenant_public_id, author_id),
  ]);

  if (!author) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="mb-4 text-xs text-muted-foreground">{siteLabel}</p>
      <h1 className="mb-2 font-serif text-4xl font-bold">{author.name}</h1>
      <p className="mb-8 text-muted-foreground">
        この著者が関わっている公開中シリーズ {author.series.length} 件
      </p>

      {author.series.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 p-6 text-sm text-muted-foreground">
          まだ公開中シリーズはありません。
        </div>
      ) : (
        <ul className="grid gap-4">
          {author.series.map((series) => (
            <li key={series.publicId}>
              <Link
                href={`/series/${series.publicId}`}
                className="block rounded-lg border border-border/70 bg-card p-4 transition hover:border-primary/40 hover:shadow-sm"
              >
                <p className="font-medium text-foreground hover:text-primary">
                  {series.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  シリーズ詳細を見る
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        <Link
          href="/authors"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          著者一覧へ戻る
        </Link>
      </div>
    </main>
  );
}
