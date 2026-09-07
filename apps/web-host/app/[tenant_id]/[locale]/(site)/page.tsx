import { getMessage } from "@publira/i18n";
import { CollectionIcon, ImageIcon } from "@publira/icons";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDate, formatList } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EyeCatchPicture } from "#components/eye-catch-picture";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  getCatalogTopFeaturedAuthors,
  getCatalogTopFeaturedLabels,
  getCatalogTopNewEpisodes,
  getCatalogTopRecommendedSeries,
  getCatalogTopUpdatedSeries,
} from "#lib/catalog-top";
import type {
  CatalogTopEpisodeItem,
  CatalogTopUpdatedSeriesItem,
} from "#lib/catalog-top";
import { getLocale, loadHostMessages } from "#lib/locale";
import type { HostMessageKey } from "#lib/locale";
import { getTenantDisplayTimeZone, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

type EpisodeLinkSource = CatalogTopEpisodeItem & {
  episodePublicId?: string;
  seriesPublicId?: string;
};

type UpdatedSeriesLinkSource = CatalogTopUpdatedSeriesItem & {
  latestEpisodePublicId?: string;
  seriesPublicId?: string;
};

const resolveEpisodeLinkIds = (
  episode: EpisodeLinkSource
): { episodeId: string; seriesId: string } | null => {
  const episodeId =
    ("episodeId" in episode ? episode.episodeId : undefined) ??
    ("episodePublicId" in episode ? episode.episodePublicId : undefined) ??
    "";
  const seriesId =
    ("seriesId" in episode ? episode.seriesId : undefined) ??
    ("seriesPublicId" in episode ? episode.seriesPublicId : undefined) ??
    "";

  if (!episodeId || !seriesId) {
    return null;
  }

  return { episodeId, seriesId };
};

const resolveUpdatedSeriesLinkIds = (
  item: UpdatedSeriesLinkSource
): { latestEpisodeId: string; seriesId: string } | null => {
  const latestEpisodeId =
    ("latestEpisodeId" in item ? item.latestEpisodeId : undefined) ??
    ("latestEpisodePublicId" in item
      ? item.latestEpisodePublicId
      : undefined) ??
    "";
  const seriesId =
    ("seriesId" in item ? item.seriesId : undefined) ??
    ("seriesPublicId" in item ? item.seriesPublicId : undefined) ??
    "";

  if (!latestEpisodeId || !seriesId) {
    return null;
  }

  return { latestEpisodeId, seriesId };
};

/**
 * One title per section, shared by the section's own failure display and by the
 * `SectionErrorBoundary` around it: the reader sees the same sentence whether
 * the read reported a failure or something threw unexpectedly.
 */
const SECTION_TITLES = {
  authors: "host.top.featured_authors_error",
  labels: "host.top.featured_labels_error",
  newEpisodes: "host.top.new_episodes_error",
  recommended: "host.top.recommended_error",
  updated: "host.top.updated_error",
} as const satisfies Record<string, HostMessageKey>;

/** The failure body a section renders from its own `ok: false` result. */
const SectionReadError = ({
  description,
  title,
}: {
  description: string;
  title: HostMessageKey;
}) => (
  <SectionError>
    <SectionErrorHeading>
      <SectionErrorTitle>
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message={title} />
        </Suspense>
      </SectionErrorTitle>
      <SectionErrorDescription>{description}</SectionErrorDescription>
    </SectionErrorHeading>
  </SectionError>
);

/** The empty state a section renders when the read succeeded with no rows. */
const SectionEmpty = ({ message }: { message: HostMessageKey }) => (
  <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
    <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
      <Message message={message} />
    </Suspense>
  </p>
);

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [siteLabel, messages] = await Promise.all([
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);

  // This page shares a route segment with `(site)/layout.tsx`, so Next.js does
  // not apply that layout's `title.template`. Compose the full tab title here.
  return {
    title: {
      absolute: `${getMessage(messages, "host.top.metadata_title")} | ${siteLabel}`,
    },
  };
};

/**
 * The one suspended piece on this page with no `SectionErrorBoundary` around
 * it, on purpose: `getTenantSiteLabel` degrades to the catalog's stand-in
 * rather than failing, the same way the header brand and the `<title>` do,
 * because it is resolved before any shell exists. There is nothing here
 * for a boundary to catch.
 */
const CatalogTopSiteLabel = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const siteLabel = await getTenantSiteLabel(tenantId, locale);

  return (
    <p className="text-sm tracking-[0.14em] text-muted-foreground uppercase">
      {siteLabel}
    </p>
  );
};

const CardGridSkeleton = ({ count = 3 }: { count?: number }) => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: count }, (_, index) => (
      <div
        className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm"
        key={index}
      >
        <div className="aspect-video animate-pulse bg-muted" />
        <div className="space-y-2 p-5">
          <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      </div>
    ))}
  </div>
);

const ListSkeleton = ({ count = 4 }: { count?: number }) => (
  <div className="grid gap-3">
    {Array.from({ length: count }, (_, index) => (
      <div
        className="h-16 animate-pulse rounded-lg border border-border/70 bg-muted/40"
        key={index}
      />
    ))}
  </div>
);

const RecommendedSeriesSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const result = await getCatalogTopRecommendedSeries(tenantId, { locale });

  if (!result.ok) {
    return (
      <SectionReadError
        description={result.message}
        title={SECTION_TITLES.recommended}
      />
    );
  }

  const recommendedSeries = result.value;

  if (recommendedSeries.length === 0) {
    return <SectionEmpty message="host.top.recommended_empty" />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {recommendedSeries.map((series) => (
        <LocaleLink
          key={series.publicId}
          className="group overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm transition hover:border-secondary/40 hover:shadow-md"
          href={`/series/${series.publicId}`}
        >
          {series.eyeCatchImageVariants &&
          series.eyeCatchImageVariants.length > 0 ? (
            <div className="aspect-video overflow-hidden bg-muted">
              <EyeCatchPicture
                alt={series.title}
                imgClassName="size-full object-cover"
                preferredType="landscape"
                variants={series.eyeCatchImageVariants}
              />
            </div>
          ) : (
            <div className="flex aspect-video items-center justify-center bg-linear-to-br from-secondary/25 via-primary/15 to-accent/20 text-secondary/50">
              <CollectionIcon className="h-10 w-10" />
            </div>
          )}
          <div className="p-5">
            <h3 className="mb-2 line-clamp-2 font-serif text-lg font-semibold transition-colors group-hover:text-secondary">
              {series.title}
            </h3>
            {series.creatorNames.length > 0 && (
              <p className="mb-2 text-sm text-muted-foreground">
                {formatList(series.creatorNames, { locale })}
              </p>
            )}
            {series.synopsis && (
              <p className="line-clamp-3 text-sm text-muted-foreground">
                {series.synopsis}
              </p>
            )}
          </div>
        </LocaleLink>
      ))}
    </div>
  );
};

const NewEpisodesSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [result, timeZone] = await Promise.all([
    getCatalogTopNewEpisodes(tenantId, { locale }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok) {
    return (
      <SectionReadError
        description={result.message}
        title={SECTION_TITLES.newEpisodes}
      />
    );
  }

  const newEpisodes = result.value;

  if (newEpisodes.length === 0) {
    return <SectionEmpty message="host.top.new_episodes_empty" />;
  }

  return (
    <ol className="grid gap-3">
      {newEpisodes.map((episode) => {
        const ids = resolveEpisodeLinkIds(episode);
        if (!ids) {
          return null;
        }

        return (
          <li key={`${ids.seriesId}-${ids.episodeId}`}>
            <LocaleLink
              className="group flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-5 py-4 shadow-sm transition hover:border-accent/40 hover:shadow-md"
              href={`/series/${ids.seriesId}/episodes/${ids.episodeId}`}
            >
              <div>
                <p className="text-xs text-muted-foreground">
                  {episode.seriesTitle}
                </p>
                <p className="font-medium transition-colors group-hover:text-secondary">
                  {episode.episodeTitle}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {formatDate(episode.publishedAt, {
                  fallback: "",
                  locale,
                  timeZone,
                })}
              </span>
            </LocaleLink>
          </li>
        );
      })}
    </ol>
  );
};

const UpdatedSeriesSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [result, timeZone, messages] = await Promise.all([
    getCatalogTopUpdatedSeries(tenantId, { locale }),
    getTenantDisplayTimeZone(tenantId),
    loadHostMessages(locale),
  ]);

  if (!result.ok) {
    return (
      <SectionReadError
        description={result.message}
        title={SECTION_TITLES.updated}
      />
    );
  }

  const updatedSeries = result.value;

  if (updatedSeries.length === 0) {
    return <SectionEmpty message="host.top.updated_empty" />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {updatedSeries.map((item) => {
        const ids = resolveUpdatedSeriesLinkIds(item);
        if (!ids) {
          return null;
        }

        return (
          <article
            key={ids.seriesId}
            className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm"
          >
            <LocaleLink className="block" href={`/series/${ids.seriesId}`}>
              {item.eyeCatchImageVariants &&
              item.eyeCatchImageVariants.length > 0 ? (
                <div className="aspect-video overflow-hidden bg-muted">
                  <EyeCatchPicture
                    alt={item.seriesTitle}
                    imgClassName="size-full object-cover"
                    preferredType="landscape"
                    variants={item.eyeCatchImageVariants}
                  />
                </div>
              ) : (
                <div className="flex aspect-video items-center justify-center bg-linear-to-br from-secondary/25 via-primary/15 to-accent/20 text-secondary/50">
                  <CollectionIcon className="h-10 w-10" />
                </div>
              )}
            </LocaleLink>
            <div className="p-5">
              <h3 className="mb-1 font-serif text-lg font-semibold">
                <LocaleLink
                  className="underline-offset-4 transition-colors hover:text-secondary hover:underline"
                  href={`/series/${ids.seriesId}`}
                >
                  {item.seriesTitle}
                </LocaleLink>
              </h3>
              {item.creatorNames.length > 0 && (
                <p className="mb-3 text-sm text-muted-foreground">
                  {formatList(item.creatorNames, { locale })}
                </p>
              )}
              <p className="mb-2 text-xs text-muted-foreground">
                {getMessage(messages, "host.top.latest_update")}
              </p>
              <LocaleLink
                className="font-medium text-accent underline-offset-4 hover:underline"
                href={`/series/${ids.seriesId}/episodes/${ids.latestEpisodeId}`}
              >
                {item.latestEpisodeTitle}
              </LocaleLink>
              <p className="mt-2 text-xs text-muted-foreground">
                {getMessage(messages, "host.top.published_on", {
                  date: formatDate(item.latestPublishedAt, {
                    fallback: getMessage(messages, "host.common.unset"),
                    locale,
                    timeZone,
                  }),
                })}
              </p>
            </div>
          </article>
        );
      })}
    </div>
  );
};

const FeaturedLabelsSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const result = await getCatalogTopFeaturedLabels(tenantId, { locale });

  if (!result.ok) {
    return (
      <SectionReadError
        description={result.message}
        title={SECTION_TITLES.labels}
      />
    );
  }

  const featuredLabels = result.value;

  if (featuredLabels.length === 0) {
    return <SectionEmpty message="host.top.featured_labels_empty" />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {featuredLabels.map((label) => (
        <LocaleLink
          key={label.publicId}
          href={`/labels/${label.publicId}`}
          className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm transition hover:border-secondary/40 hover:shadow-md"
        >
          {label.eyeCatchImageVariants &&
          label.eyeCatchImageVariants.length > 0 ? (
            <div className="aspect-video overflow-hidden bg-muted">
              <EyeCatchPicture
                alt={label.name}
                imgClassName="size-full object-cover"
                variants={label.eyeCatchImageVariants}
              />
            </div>
          ) : (
            <div className="flex aspect-video items-center justify-center bg-linear-to-br from-accent/25 via-primary/10 to-secondary/20 text-accent/55">
              <ImageIcon className="h-10 w-10" />
            </div>
          )}

          <div className="p-4">
            <p className="font-medium">{label.name}</p>
          </div>
        </LocaleLink>
      ))}
    </div>
  );
};

const FeaturedAuthorsSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [result, messages] = await Promise.all([
    getCatalogTopFeaturedAuthors(tenantId, { locale }),
    loadHostMessages(locale),
  ]);

  if (!result.ok) {
    return (
      <SectionReadError
        description={result.message}
        title={SECTION_TITLES.authors}
      />
    );
  }

  const featuredAuthors = result.value;

  if (featuredAuthors.length === 0) {
    return <SectionEmpty message="host.top.featured_authors_empty" />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {featuredAuthors.map((author) => (
        <LocaleLink
          key={author.id}
          className="group rounded-lg border border-border/70 bg-card p-5 shadow-sm transition hover:border-accent/40 hover:shadow-md"
          href={`/authors/${author.id}`}
        >
          <p className="mb-1 font-medium transition-colors group-hover:text-secondary">
            {author.name}
          </p>
          <p className="text-sm text-muted-foreground">
            {getMessage(messages, "host.common.series_count", {
              count: author.seriesCount,
            })}
          </p>
        </LocaleLink>
      ))}
    </div>
  );
};

const Page = () => (
  <main className="mx-auto max-w-6xl px-6 py-12">
    <header className="mb-10 space-y-4">
      <Suspense
        fallback={
          <div
            aria-hidden
            className="h-4 w-24 animate-pulse rounded bg-muted"
          />
        }
      >
        <CatalogTopSiteLabel />
      </Suspense>
      <h1 className="font-serif text-4xl font-bold">
        <Suspense fallback={<SkeletonLine className="h-9 w-64" />}>
          <Message message="host.top.title" />
        </Suspense>
      </h1>
      <p className="max-w-3xl text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-5 w-full max-w-lg" />}>
          <Message message="host.top.description" />
        </Suspense>
      </p>
      <div className="flex flex-wrap gap-3">
        <LocaleLink
          className="rounded-full bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:opacity-90"
          href="/series"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="host.top.to_series" />
          </Suspense>
        </LocaleLink>
        <LocaleLink
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
          href="/labels"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="host.top.to_labels" />
          </Suspense>
        </LocaleLink>
        <LocaleLink
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
          href="/authors"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="host.top.to_authors" />
          </Suspense>
        </LocaleLink>
      </div>
    </header>

    <section aria-labelledby="recommended-works" className="mb-12">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2
          id="recommended-works"
          className="font-serif text-2xl font-semibold"
        >
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="host.top.recommended_heading" />
          </Suspense>
        </h2>
        <LocaleLink
          className="text-sm font-medium text-accent underline-offset-4 hover:underline"
          href="/series"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="host.top.view_all" />
          </Suspense>
        </LocaleLink>
      </div>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message={SECTION_TITLES.recommended} />
          </Suspense>
        }
      >
        <Suspense fallback={<CardGridSkeleton />}>
          <RecommendedSeriesSection />
        </Suspense>
      </SectionErrorBoundary>
    </section>

    <section aria-labelledby="new-episodes" className="mb-12">
      <h2 id="new-episodes" className="mb-4 font-serif text-2xl font-semibold">
        <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
          <Message message="host.top.new_episodes_heading" />
        </Suspense>
      </h2>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message={SECTION_TITLES.newEpisodes} />
          </Suspense>
        }
      >
        <Suspense fallback={<ListSkeleton />}>
          <NewEpisodesSection />
        </Suspense>
      </SectionErrorBoundary>
    </section>

    <section aria-labelledby="updated-series" className="mb-12">
      <h2
        id="updated-series"
        className="mb-4 font-serif text-2xl font-semibold"
      >
        <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
          <Message message="host.top.updated_heading" />
        </Suspense>
      </h2>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message={SECTION_TITLES.updated} />
          </Suspense>
        }
      >
        <Suspense fallback={<CardGridSkeleton />}>
          <UpdatedSeriesSection />
        </Suspense>
      </SectionErrorBoundary>
    </section>

    <section aria-labelledby="featured-labels" className="mb-12">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="featured-labels" className="font-serif text-2xl font-semibold">
          <Suspense fallback={<SkeletonLine className="h-7 w-44" />}>
            <Message message="host.top.featured_labels_heading" />
          </Suspense>
        </h2>
        <LocaleLink
          className="text-sm font-medium text-accent underline-offset-4 hover:underline"
          href="/labels"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="host.top.to_labels" />
          </Suspense>
        </LocaleLink>
      </div>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message={SECTION_TITLES.labels} />
          </Suspense>
        }
      >
        <Suspense fallback={<CardGridSkeleton />}>
          <FeaturedLabelsSection />
        </Suspense>
      </SectionErrorBoundary>
    </section>

    <section aria-labelledby="featured-authors">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="featured-authors" className="font-serif text-2xl font-semibold">
          <Suspense fallback={<SkeletonLine className="h-7 w-36" />}>
            <Message message="host.top.featured_authors_heading" />
          </Suspense>
        </h2>
        <LocaleLink
          className="text-sm font-medium text-accent underline-offset-4 hover:underline"
          href="/authors"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="host.top.to_authors" />
          </Suspense>
        </LocaleLink>
      </div>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message={SECTION_TITLES.authors} />
          </Suspense>
        }
      >
        <Suspense fallback={<CardGridSkeleton />}>
          <FeaturedAuthorsSection />
        </Suspense>
      </SectionErrorBoundary>
    </section>
  </main>
);

export default Page;
