import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
} from "@publira/ui-components/empty-state";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { z } from "zod";

import { FollowControlSkeleton } from "#components/follow-button";
import { FollowControl } from "#components/follow-control";
import {
  ListPagination,
  ListPaginationSkeleton,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { PageLoadError } from "#components/page-load-error";
import { Prose } from "#components/prose";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { SeriesShelf, SeriesShelfSkeleton } from "#components/series-shelf";
import { getPublishedCreatorDetail } from "#lib/creators";
import type { PublishedCreatorDetail } from "#lib/creators";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import {
  creatorDetailHref,
  parseCreatorDetailSearchParams,
} from "./_lib/search-params";

const CREATOR_SERIES_PAGE_SIZE = 20;

/** The creator's portrait, at the size the page draws it. */
const CREATOR_ICON_SIZE = 96;

type CreatorDetailPageProps =
  PageProps<"/[tenant_id]/[locale]/creators/[creator_id]">;

const creatorDetailParamsSchema = z.object({
  creator_id: routeParamString(),
});

/**
 * `"use cache"` keys on the serialized arguments, so metadata and the page
 * body have to pass the same `{ limit, token }` or one request fills two
 * entries and hits the RPC twice.
 */
const loadPublishedCreatorDetail = (
  tenantId: string,
  creatorId: string,
  locale: Locale,
  token: string
) =>
  getPublishedCreatorDetail(tenantId, creatorId, {
    limit: CREATOR_SERIES_PAGE_SIZE,
    locale,
    token,
  });

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "creator_id");

export const generateMetadata = async ({
  params,
  searchParams,
}: CreatorDetailPageProps): Promise<Metadata> => {
  const [rawParams, tenantId, resolvedSearchParams, locale] = await Promise.all(
    [params, getTenantId(), searchParams, getLocale()]
  );
  const parsedParams = parseRouteParams(creatorDetailParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { creator_id } = parsedParams;

  const { token } = parseCreatorDetailSearchParams(resolvedSearchParams);

  const [result, messages] = await Promise.all([
    loadPublishedCreatorDetail(tenantId, creator_id, locale, token),
    loadHostMessages(locale),
  ]);

  // An unavailable creator reads as "not found" for the `<title>` alone; the
  // page body below says what actually happened.
  const creator = result.ok ? result.value : null;

  if (!creator) {
    return {
      title: getMessage(messages, "host.creators.not_found_title"),
    };
  }

  return {
    description:
      creator.profileText ||
      getMessage(messages, "host.creators.detail_description", {
        count: creator.seriesCount,
        name: creator.name,
      }),
    title: creator.name,
  };
};

const CreatorDetailSkeleton = () => (
  <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
    <div className="grid gap-4">
      <div className="flex items-start gap-5">
        <Skeleton className="size-24 shrink-0 rounded-surface" />
        <div className="grid flex-1 gap-2">
          <SkeletonLine className="h-8 w-1/2" />
          <SkeletonLine className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="h-16 w-full max-w-(--measure-prose)" />
    </div>
    <SeriesShelfSkeleton />
  </div>
);

/**
 * The creator's portrait. `alt` is an attribute rather than a node, so this is
 * the one piece of the header that has to wait for the catalog; it waits
 * behind a boundary of its own so the name beside it does not.
 */
const CreatorIcon = async ({ name, url }: { name: string; url: string }) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <Image
      alt={getMessage(messages, "host.creators.icon_alt", { name })}
      className="size-24 shrink-0 rounded-surface object-cover"
      decoding="async"
      height={CREATOR_ICON_SIZE}
      src={url}
      width={CREATOR_ICON_SIZE}
    />
  );
};

/**
 * The pagination's `<nav>`, and the one component on this screen that resolves
 * the catalog for a string: an `aria-label` cannot be a node. The key stays
 * written out here, beside the `getMessage` that reads it.
 */
const CreatorSeriesPaginationNav = async ({
  children,
}: {
  children: ReactNode;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <ListPagination
      aria-label={getMessage(messages, "host.creators.series_pagination_aria")}
    >
      {children}
    </ListPagination>
  );
};

const CreatorSeriesPagination = ({
  creatorId,
  nextToken,
  previousToken,
}: {
  creatorId: string;
  nextToken: string;
  previousToken: string;
}) => (
  <Suspense fallback={<ListPaginationSkeleton />}>
    <CreatorSeriesPaginationNav>
      <ListPaginationStep
        href={previousToken ? creatorDetailHref(creatorId, previousToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep
        href={nextToken ? creatorDetailHref(creatorId, nextToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
        </Suspense>
      </ListPaginationStep>
    </CreatorSeriesPaginationNav>
  </Suspense>
);

const CreatorRelatedSeries = async ({
  creator,
  token,
}: {
  creator: PublishedCreatorDetail;
  token: string;
}) => {
  const locale = await getLocale();

  if (creator.series.length === 0) {
    if (!token) {
      return (
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.creators.series_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
      );
    }

    // The covers this page pointed at are gone. The server hands back a token
    // for the neighbouring page when it can, and empty tokens when it cannot —
    // then the only way out is the first page (`proto/README.md`).
    return (
      <div className="grid gap-8">
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.series.page_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
        {creator.previousToken || creator.nextToken ? (
          <CreatorSeriesPagination
            creatorId={creator.id}
            nextToken={creator.nextToken}
            previousToken={creator.previousToken}
          />
        ) : (
          <p>
            <LocaleLink
              className="text-sm text-primary underline underline-offset-4"
              href={creatorDetailHref(creator.id, "")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="host.creators.series_first_page" />
              </Suspense>
            </LocaleLink>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <SeriesShelf locale={locale} series={creator.series} />
      <CreatorSeriesPagination
        creatorId={creator.id}
        nextToken={creator.nextToken}
        previousToken={creator.previousToken}
      />
    </div>
  );
};

const CreatorDetailContent = async ({
  params,
  searchParams,
}: CreatorDetailPageProps) => {
  const [rawParams, tenantId, resolvedSearchParams, locale] = await Promise.all(
    [params, getTenantId(), searchParams, getLocale()]
  );
  const parsedParams = parseRouteParams(creatorDetailParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { creator_id } = parsedParams;

  const { token } = parseCreatorDetailSearchParams(resolvedSearchParams);

  // A failed read is a value, not a throw: a `"use cache"` fill that throws
  // fails the whole request, so neither this page nor any boundary would get
  // to render anything.
  const result = await loadPublishedCreatorDetail(
    tenantId,
    creator_id,
    locale,
    token
  );

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  const creator = result.value;

  if (!creator) {
    notFound();
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
      <div className="grid gap-4">
        <div className="flex items-start gap-5">
          {creator.iconImageUrl && (
            <Suspense
              fallback={
                <Skeleton className="size-24 shrink-0 rounded-surface" />
              }
            >
              <CreatorIcon name={creator.name} url={creator.iconImageUrl} />
            </Suspense>
          )}
          <div className="grid min-w-0 flex-1 gap-2">
            <h1 className="font-serif text-3xl leading-tight">
              {creator.name}
            </h1>
            <p className="text-sm text-muted-foreground tabular-nums">
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message
                  message="host.common.series_count"
                  values={{ count: creator.seriesCount }}
                />
              </Suspense>
            </p>
          </div>
        </div>

        {creator.profileText ? (
          <Prose locale={locale}>{creator.profileText}</Prose>
        ) : (
          <p className="text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="host.creators.profile_empty" />
            </Suspense>
          </p>
        )}

        <div>
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="host.follow.control_error" />
              </Suspense>
            }
          >
            <Suspense fallback={<FollowControlSkeleton />}>
              <FollowControl
                publicId={creator.id}
                returnTo={`/creators/${creator.id}`}
                targetKind="creator"
                targetName={creator.name}
                tenantId={tenantId}
              />
            </Suspense>
          </SectionErrorBoundary>
        </div>
      </div>

      <section className="grid gap-4">
        <div className="grid gap-1 border-b border-border pb-2">
          <h2 className="font-serif text-xl leading-tight">
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="host.creators.series_heading" />
            </Suspense>
          </h2>
          <p className="text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.creators.series_description" />
            </Suspense>
          </p>
        </div>

        <Suspense fallback={<SeriesShelfSkeleton />}>
          <CreatorRelatedSeries creator={creator} token={token} />
        </Suspense>
      </section>

      <p>
        <LocaleLink
          className="text-sm text-primary underline underline-offset-4"
          href="/creators"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="host.creators.back_to_list" />
          </Suspense>
        </LocaleLink>
      </p>
    </main>
  );
};

const Page = (props: CreatorDetailPageProps) => (
  <Suspense fallback={<CreatorDetailSkeleton />}>
    <CreatorDetailContent {...props} />
  </Suspense>
);

export default Page;
