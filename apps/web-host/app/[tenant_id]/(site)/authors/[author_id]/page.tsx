import {
  createPlaceholderStaticParams,
  guardPlaceholders,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getPublishedAuthorDetail } from "#lib/authors";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "author_id");

const getAuthorInitials = (name: string) => {
  const normalizedName = name.trim();
  if (normalizedName.length === 0) {
    return "?";
  }

  const words = normalizedName.split(/\s+/u).filter((word) => word.length > 0);
  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((word) => [...word][0] ?? "")
      .join("");
  }

  return [...normalizedName.replaceAll(/\s+/gu, "")].slice(0, 2).join("");
};

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ author_id: string; tenant_id: string }>;
}): Promise<Metadata> => {
  const { author_id } = await params;
  const tenantId = await getTenantId();

  guardPlaceholders({ author_id });

  const [siteLabel, author] = await Promise.all([
    getTenantSiteLabel(tenantId),
    getPublishedAuthorDetail(tenantId, author_id),
  ]);

  if (!author) {
    return {
      title: `著者が見つかりません | ${siteLabel}`,
    };
  }

  return {
    description:
      author.profileText ||
      `${author.name} が関わっている公開中シリーズ ${author.series.length} 件`,
    title: `${author.name} | ${siteLabel}`,
  };
};

const Page = async ({
  params,
}: PageProps<"/[tenant_id]/authors/[author_id]">) => {
  const { author_id } = await params;
  const tenantId = await getTenantId();

  guardPlaceholders({ author_id });

  const [siteLabel, author] = await Promise.all([
    getTenantSiteLabel(tenantId),
    getPublishedAuthorDetail(tenantId, author_id),
  ]);

  if (!author) {
    notFound();
  }

  const authorInitials = getAuthorInitials(author.name);
  const hasProfileText = author.profileText.length > 0;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <section className="mb-10 rounded-3xl border border-border/70 bg-card/90 p-8 shadow-sm">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          {author.iconImageUrl ? (
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border border-border/60 bg-muted/20">
              <Image
                alt={`${author.name} のアイコン`}
                className="h-full w-full object-cover"
                decoding="async"
                height={96}
                src={author.iconImageUrl}
                unoptimized
                width={96}
              />
            </div>
          ) : (
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-primary/15 font-serif text-3xl font-semibold text-primary">
              {authorInitials}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="mb-3 text-xs uppercase tracking-[0.24em] text-muted-foreground">
              {siteLabel}
            </p>
            <h1 className="mb-2 font-serif text-4xl font-bold text-foreground">
              {author.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              公開中シリーズ {author.series.length} 件
            </p>

            <div className="mt-6 rounded-2xl bg-muted/30 p-5">
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                プロフィール
              </h2>
              {hasProfileText ? (
                <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                  {author.profileText}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  プロフィールはまだ公開されていません。
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 className="font-serif text-2xl font-semibold">関連シリーズ</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              この著者が関わっている公開中シリーズ一覧です。
            </p>
          </div>
        </div>

        {author.series.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-6 text-sm text-muted-foreground">
            まだ公開中シリーズはありません。
          </div>
        ) : (
          <ul className="grid gap-4">
            {author.series.map((series) => (
              <li key={series.publicId}>
                <Link
                  href={`/series/${series.publicId}`}
                  className="block rounded-2xl border border-border/70 bg-card p-5 transition hover:border-primary/40 hover:shadow-sm"
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
      </section>

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
};

export default Page;
