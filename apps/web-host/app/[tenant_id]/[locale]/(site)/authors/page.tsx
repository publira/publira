import { getMessage } from "@publira/i18n";
import { UserIcon } from "@publira/icons";
import { SectionError } from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listPublishedAuthors } from "#lib/authors";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  authorsListHref,
  parseAuthorsListSearchParams,
} from "./_lib/search-params";

const AUTHORS_PAGE_SIZE = 12;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.authors.list_title") };
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

/**
 * The tenant's name sits inside the sentence, and the two locales put it in
 * different places, so the whole line resolves at once rather than streaming
 * the name into a fixed frame.
 */
const AuthorsListDescription = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [siteLabel, messages] = await Promise.all([
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);

  return getMessage(messages, "host.authors.list_description", {
    site: siteLabel,
  });
};

const AuthorsPagination = async ({
  nextToken,
  previousToken,
}: {
  nextToken: string;
  previousToken: string;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <nav
      aria-label={getMessage(messages, "host.authors.pagination_aria")}
      className="mt-8 flex items-center justify-center gap-6"
    >
      {previousToken ? (
        <LocaleLink
          href={authorsListHref(previousToken)}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {getMessage(messages, "host.common.previous_page")}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          {getMessage(messages, "host.common.previous_page")}
        </span>
      )}

      {nextToken ? (
        <LocaleLink
          href={authorsListHref(nextToken)}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {getMessage(messages, "host.common.next_page")}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          {getMessage(messages, "host.common.next_page")}
        </span>
      )}
    </nav>
  );
};

const AuthorsListData = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/[locale]/authors">["searchParams"];
}) => {
  const [resolvedSearchParams, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const { token } = parseAuthorsListSearchParams(resolvedSearchParams);

  const [result, messages] = await Promise.all([
    listPublishedAuthors(tenantId, {
      limit: AUTHORS_PAGE_SIZE,
      locale,
      token,
    }),
    loadHostMessages(locale),
  ]);

  if (!result.ok) {
    return (
      <SectionError
        description={result.message}
        title={getMessage(messages, "host.authors.list_error")}
      />
    );
  }

  const { authors, nextToken, previousToken } = result.value;

  if (authors.length === 0) {
    if (!token) {
      return (
        <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-6 py-20 text-center">
          <h2 className="mb-2 font-serif text-2xl font-semibold">
            {getMessage(messages, "host.authors.list_empty_title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {getMessage(messages, "host.authors.list_empty_description")}
          </p>
        </div>
      );
    }

    // The rows this page pointed at are gone. The server hands back a token for
    // the neighbouring page when it can, and empty tokens when it cannot — then
    // the only way out is the first page (`proto/README.md`).
    return (
      <div className="py-20 text-center">
        <p className="mb-4 text-muted-foreground">
          {getMessage(messages, "host.authors.page_empty")}
        </p>
        {previousToken || nextToken ? (
          <AuthorsPagination
            nextToken={nextToken}
            previousToken={previousToken}
          />
        ) : (
          <LocaleLink
            href={authorsListHref("")}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {getMessage(messages, "host.authors.first_page")}
          </LocaleLink>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {authors.map((author) => (
          <LocaleLink
            key={author.id}
            href={`/authors/${author.id}`}
            className="group overflow-hidden rounded-lg border border-border/70 bg-card p-6 shadow-sm transition hover:border-secondary/40 hover:shadow-md"
          >
            {author.iconImageUrl ? (
              <div className="mb-4 h-12 w-12 overflow-hidden rounded-full border border-border/60 bg-muted/20">
                <Image
                  alt={getMessage(messages, "host.authors.icon_alt", {
                    name: author.name,
                  })}
                  className="h-full w-full object-cover"
                  decoding="async"
                  height={48}
                  src={author.iconImageUrl}
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
              {getMessage(messages, "host.common.series_count", {
                count: author.seriesCount,
              })}
            </p>
          </LocaleLink>
        ))}
      </div>

      <AuthorsPagination nextToken={nextToken} previousToken={previousToken} />
    </>
  );
};

const AuthorsPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/authors">) => (
  <main className="mx-auto max-w-6xl px-6 py-12">
    <h1 className="mb-2 font-serif text-4xl font-bold">
      <Suspense fallback={<SkeletonLine className="h-9 w-48" />}>
        <Message message="host.authors.list_title" />
      </Suspense>
    </h1>
    <p className="mb-8 text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-5 w-80" />}>
        <AuthorsListDescription />
      </Suspense>
    </p>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="host.authors.list_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<AuthorsListSkeleton />}>
        <AuthorsListData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default AuthorsPage;
