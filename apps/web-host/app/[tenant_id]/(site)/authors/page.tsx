import { UserIcon } from "@publira/icons";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listPublishedAuthors, normalizeAuthorsPage } from "#lib/authors";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

const AUTHORS_PAGE_SIZE = 12;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const siteLabel = await getTenantSiteLabel(tenantId);

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

const TenantSiteLabel = async () => {
  const tenantId = await getTenantId();
  return getTenantSiteLabel(tenantId);
};

const AuthorsListData = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const tenantId = await getTenantId();

  const resolvedSearchParams = await searchParams;
  const page = normalizeAuthorsPage(resolvedSearchParams.page);

  const { authors, hasNextPage } = await listPublishedAuthors(tenantId, {
    page,
    pageSize: AUTHORS_PAGE_SIZE,
  });

  if (authors.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-6 py-20 text-center">
        <h2 className="mb-2 font-serif text-2xl font-semibold">
          まだ著者がいません
        </h2>
        <p className="text-sm text-muted-foreground">
          公開中のシリーズに著者が設定されると、ここに表示されます。
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {authors.map((author) => (
          <Link
            key={author.id}
            href={`/authors/${author.id}`}
            className="group overflow-hidden rounded-lg border border-border/70 bg-card p-6 shadow-sm transition hover:border-secondary/40 hover:shadow-md"
          >
            {author.iconImageUrl ? (
              <div className="mb-4 h-12 w-12 overflow-hidden rounded-full border border-border/60 bg-muted/20">
                <Image
                  alt={`${author.name} のアイコン`}
                  className="h-full w-full object-cover"
                  decoding="async"
                  height={48}
                  src={author.iconImageUrl}
                  unoptimized
                  width={48}
                />
              </div>
            ) : (
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <UserIcon className="h-6 w-6" />
              </div>
            )}
            <h2 className="mb-1 font-serif text-lg font-semibold transition-colors group-hover:text-secondary">
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

const AuthorsPage = ({ searchParams }: PageProps<"/[tenant_id]/authors">) => (
  <main className="mx-auto max-w-6xl px-6 py-12">
    <h1 className="mb-2 font-serif text-4xl font-bold">著者一覧</h1>
    <p className="mb-8 text-muted-foreground">
      <Suspense
        fallback={
          <span
            aria-hidden
            className="inline-block h-4 w-16 animate-pulse rounded bg-muted align-middle"
          />
        }
      >
        <TenantSiteLabel />
      </Suspense>
      に登録されている著者をご紹介します
    </p>

    <SectionErrorBoundary title="著者一覧を表示できませんでした">
      <Suspense fallback={<AuthorsListSkeleton />}>
        <AuthorsListData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default AuthorsPage;
