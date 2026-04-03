import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { listPublishedAuthors, normalizeAuthorsPage } from "#lib/authors";
import { getTenantSiteLabel } from "#lib/tenant";

const AUTHORS_PAGE_SIZE = 12;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ tenant_public_id: string }>;
}): Promise<Metadata> => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);
  const siteLabel = await getTenantSiteLabel(tenant_public_id);

  return {
    title: `著者一覧 | ${siteLabel}`,
  };
};

const AuthorsListSkeleton = () => (
  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: 6 }, (_, i) => (
      <div
        key={i}
        className="overflow-hidden rounded-lg border border-border/70 bg-card p-6 shadow-sm"
      >
        <div className="mb-4 h-12 w-12 animate-pulse rounded-full bg-muted" />
        <div className="mb-1 h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
      </div>
    ))}
  </div>
);

const AuthorsListData = async ({
  params,
  searchParams,
}: {
  params: Promise<{ tenant_public_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const resolvedSearchParams = await searchParams;
  const page = normalizeAuthorsPage(resolvedSearchParams.page);
  const siteLabel = await getTenantSiteLabel(tenant_public_id);

  let authorsData;
  try {
    authorsData = await listPublishedAuthors(tenant_public_id, {
      page,
      pageSize: AUTHORS_PAGE_SIZE,
    });
  } catch {
    return (
      <>
        <p className="mb-8 text-muted-foreground">
          {siteLabel} に登録されている著者をご紹介します
        </p>

        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
          <p className="mb-4 text-destructive">
            著者一覧の取得に失敗しました。時間をおいて再試行してください。
          </p>
          <Link
            href={page > 1 ? `?page=${page}` : "."}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            再試行
          </Link>
        </div>
      </>
    );
  }

  const { authors, hasNextPage } = authorsData;

  if (authors.length === 0) {
    return (
      <>
        <p className="mb-8 text-muted-foreground">
          {siteLabel} に登録されている著者をご紹介します
        </p>

        <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-6 py-20 text-center">
          <h2 className="mb-2 font-serif text-2xl font-semibold">
            まだ著者がいません
          </h2>
          <p className="text-sm text-muted-foreground">
            公開中のシリーズに著者が設定されると、ここに表示されます。
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="mb-8 text-muted-foreground">
        {siteLabel} に登録されている著者をご紹介します
      </p>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {authors.map((author) => (
          <Link
            key={author.id}
            href={`/authors/${author.id}`}
            className="group overflow-hidden rounded-lg border border-border/70 bg-card p-6 shadow-sm transition hover:shadow-md"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/20 text-primary">
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
            <h2 className="mb-1 font-serif text-lg font-semibold group-hover:text-primary">
              {author.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              公開中シリーズ {author.seriesCount} 件
            </p>
          </Link>
        ))}
      </div>

      <nav
        className="mt-8 flex items-center justify-center gap-6"
        aria-label="著者一覧ページング"
      >
        {page > 1 ? (
          <Link
            href={page === 2 ? "." : `?page=${page - 1}`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            前のページ
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">前のページ</span>
        )}

        <span className="text-sm text-muted-foreground">{page} ページ目</span>

        {hasNextPage ? (
          <Link
            href={`?page=${page + 1}`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            次のページ
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">次のページ</span>
        )}
      </nav>
    </>
  );
};

export default function AuthorsPage({
  params,
  searchParams,
}: PageProps<"/[tenant_public_id]/authors">) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="mb-2 font-serif text-4xl font-bold">著者一覧</h1>

      <Suspense fallback={<AuthorsListSkeleton />}>
        <AuthorsListData params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
