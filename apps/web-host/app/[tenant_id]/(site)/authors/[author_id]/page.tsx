import {
  createPlaceholderStaticParams,
  guardPlaceholders,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageLoadError } from "#components/page-load-error";
import { getPublishedAuthorDetail } from "#lib/authors";
import type { PublishedAuthorDetail } from "#lib/authors";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  authorDetailHref,
  parseAuthorDetailSearchParams,
} from "./_lib/search-params";

const AUTHOR_SERIES_PAGE_SIZE = 20;

type AuthorDetailPageProps = PageProps<"/[tenant_id]/authors/[author_id]">;

/**
 * `"use cache"` keys on the serialized arguments, so metadata and the page
 * body have to pass the same `{ limit, token }` or one request fills two
 * entries and hits the RPC twice.
 */
const loadPublishedAuthorDetail = (
  tenantId: string,
  authorId: string,
  token: string
) =>
  getPublishedAuthorDetail(tenantId, authorId, {
    limit: AUTHOR_SERIES_PAGE_SIZE,
    token,
  });

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
  searchParams,
}: AuthorDetailPageProps): Promise<Metadata> => {
  const [{ author_id }, tenantId, resolvedSearchParams] = await Promise.all([
    params,
    getTenantId(),
    searchParams,
  ]);

  guardPlaceholders({ author_id });

  const { token } = parseAuthorDetailSearchParams(resolvedSearchParams);

  const [siteLabel, result] = await Promise.all([
    getTenantSiteLabel(tenantId),
    loadPublishedAuthorDetail(tenantId, author_id, token),
  ]);

  // An unavailable author reads as "not found" for the `<title>` alone; the
  // page body below says what actually happened.
  const author = result.ok ? result.value : null;

  if (!author) {
    return {
      title: `著者が見つかりません | ${siteLabel}`,
    };
  }

  return {
    description:
      author.profileText ||
      `${author.name} が関わっている公開中シリーズ ${author.seriesCount} 件`,
    title: `${author.name} | ${siteLabel}`,
  };
};

const AuthorDetailSkeleton = () => (
  <div className="mx-auto max-w-5xl px-6 py-12">
    <div className="mb-10 rounded-3xl border border-border/70 bg-card/90 p-8 shadow-sm">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="h-24 w-24 shrink-0 animate-pulse rounded-full bg-muted" />
        <div className="min-w-0 flex-1 space-y-4">
          <div className="h-9 w-1/2 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
          <div className="h-24 w-full animate-pulse rounded-2xl bg-muted" />
        </div>
      </div>
    </div>
    <div className="grid gap-4">
      {Array.from({ length: 3 }, (_, index) => (
        <div
          className="h-20 animate-pulse rounded-2xl border border-border/70 bg-muted/40"
          key={index}
        />
      ))}
    </div>
  </div>
);

const AuthorSeriesPagination = ({
  authorId,
  nextToken,
  previousToken,
}: {
  authorId: string;
  nextToken: string;
  previousToken: string;
}) => (
  <nav
    aria-label="関連シリーズページング"
    className="mt-8 flex items-center justify-center gap-6"
  >
    {previousToken ? (
      <Link
        href={authorDetailHref(authorId, previousToken)}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        前のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">前のページ</span>
    )}

    {nextToken ? (
      <Link
        href={authorDetailHref(authorId, nextToken)}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        次のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">次のページ</span>
    )}
  </nav>
);

const AuthorRelatedSeries = ({
  author,
  token,
}: {
  author: PublishedAuthorDetail;
  token: string;
}) => {
  if (author.series.length === 0) {
    if (!token) {
      return (
        <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-6 text-sm text-muted-foreground">
          まだ公開中シリーズはありません。
        </div>
      );
    }

    return (
      <div className="py-10 text-center">
        <p className="mb-4 text-sm text-muted-foreground">
          このページに表示できるシリーズがありません。
        </p>
        {author.previousToken || author.nextToken ? (
          <AuthorSeriesPagination
            authorId={author.id}
            nextToken={author.nextToken}
            previousToken={author.previousToken}
          />
        ) : (
          <Link
            href={authorDetailHref(author.id, "")}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            関連シリーズの先頭へ
          </Link>
        )}
      </div>
    );
  }

  return (
    <>
      <ul className="grid gap-4">
        {author.series.map((series) => (
          <li key={series.publicId}>
            <Link
              href={`/series/${series.publicId}`}
              className="block rounded-2xl border border-border/70 bg-card p-5 transition hover:border-secondary/40 hover:shadow-sm"
            >
              <p className="font-medium text-foreground">{series.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                シリーズ詳細を見る
              </p>
            </Link>
          </li>
        ))}
      </ul>
      <AuthorSeriesPagination
        authorId={author.id}
        nextToken={author.nextToken}
        previousToken={author.previousToken}
      />
    </>
  );
};

const AuthorDetailContent = async ({
  params,
  searchParams,
}: AuthorDetailPageProps) => {
  const [{ author_id }, tenantId, resolvedSearchParams] = await Promise.all([
    params,
    getTenantId(),
    searchParams,
  ]);

  guardPlaceholders({ author_id });

  const { token } = parseAuthorDetailSearchParams(resolvedSearchParams);

  // A failed read is a value, not a throw: a `"use cache"` fill that throws
  // fails the whole request, so neither this page nor any boundary would get
  // to render anything (#672).
  const [siteLabel, result] = await Promise.all([
    getTenantSiteLabel(tenantId),
    loadPublishedAuthorDetail(tenantId, author_id, token),
  ]);

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  const author = result.value;

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
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-accent font-serif text-3xl font-semibold text-accent-foreground">
              {authorInitials}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="mb-3 text-xs tracking-[0.24em] text-muted-foreground uppercase">
              {siteLabel}
            </p>
            <h1 className="mb-2 font-serif text-4xl font-bold text-foreground">
              {author.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              公開中シリーズ {author.seriesCount} 件
            </p>

            <div className="mt-6 rounded-2xl bg-muted/30 p-5">
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                プロフィール
              </h2>
              {hasProfileText ? (
                <p className="text-sm leading-7 whitespace-pre-wrap text-muted-foreground">
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

        <AuthorRelatedSeries author={author} token={token} />
      </section>

      <div className="mt-8">
        <Link
          href="/authors"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          著者一覧へ戻る
        </Link>
      </div>
    </main>
  );
};

const Page = (props: AuthorDetailPageProps) => (
  <Suspense fallback={<AuthorDetailSkeleton />}>
    <AuthorDetailContent {...props} />
  </Suspense>
);

export default Page;
