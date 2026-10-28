import type { Locale } from "@publira/i18n";
import * as EmptyState from "@publira/ui-components/empty-state";
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

import {
  FollowControlSkeleton,
  FollowControl,
} from "#components/follow-control";
import { JsonLd } from "#components/json-ld";
import * as ListPagination from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { PageLoadError } from "#components/page-load-error";
import { Prose } from "#components/prose";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import * as SeriesShelf from "#components/series-shelf";
import {
  CREATOR_SERIES_PAGE_SIZE,
  getPublishedCreatorDetail,
} from "#lib/creators";
import type { PublishedCreatorDetail } from "#lib/creators";
import { getMessages } from "#lib/get-messages";
import { breadcrumbJsonLd, creatorJsonLd } from "#lib/json-ld";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { openGraphCardImage, openGraphMetadata } from "#lib/open-graph";
import { tenantOpenGraphCardPath } from "#lib/open-graph-card-subject";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";
import { tenantLocaleAlternates } from "#lib/tenant-locale-path";

import {
  creatorDetailHref,
  parseCreatorDetailSearchParams,
} from "./_lib/search-params";

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
 * entries and hits the RPC twice. Both look the creator up on their first
 * page, which needs nothing but the path.
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
}: CreatorDetailPageProps): Promise<Metadata> => {
  const [rawParams, tenantId, locale] = await Promise.all([
    params,
    getTenantId(),
    getLocale(),
  ]);
  const parsedParams = parseRouteParams(creatorDetailParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { creator_id } = parsedParams;

  const [result, t, alternates, siteLabel, cardPath] = await Promise.all([
    loadPublishedCreatorDetail(tenantId, creator_id, locale, ""),
    getMessagesFor(locale),
    tenantLocaleAlternates(tenantId, locale, `/creators/${creator_id}`),
    getTenantSiteLabel(tenantId, locale),
    tenantOpenGraphCardPath(tenantId, locale, {
      creatorId: creator_id,
      kind: "creator",
    }),
  ]);

  // An unavailable creator reads as "not found" for the `<title>` alone; the
  // page body below says what actually happened.
  const creator = result.ok ? result.value : null;

  if (!creator) {
    return {
      title: t("storefront.creators.not_found_title"),
    };
  }

  const description =
    creator.profileText ||
    t("storefront.creators.detail_description", {
      count: creator.seriesCount,
      name: creator.name,
    });

  return {
    ...openGraphMetadata({
      description,
      image: cardPath ? openGraphCardImage(cardPath, creator.name) : undefined,
      siteName: siteLabel,
      title: creator.name,
      type: "website",
      url: alternates?.canonical,
    }),
    alternates,
    description,
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
      <Skeleton className="h-16 w-full max-w-measure-prose" />
    </div>
    <SeriesShelf.Skeleton />
  </div>
);

/**
 * The creator's portrait. `alt` is an attribute rather than a node, so this is
 * the one piece of the header that has to wait for the catalog; it waits
 * behind a boundary of its own so the name beside it does not.
 */
const CreatorIcon = async ({ name, url }: { name: string; url: string }) => {
  const t = await getMessages();

  return (
    <Image
      alt={t("storefront.creators.icon_alt", { name })}
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
 * the accessor: an `aria-label` cannot be a node. The key stays written out
 * here, beside the call that reads it.
 */
const CreatorSeriesPaginationNav = async ({
  children,
}: {
  children: ReactNode;
}) => {
  const t = await getMessages();

  return (
    <ListPagination.Root
      aria-label={t("storefront.creators.series_pagination_aria")}
    >
      {children}
    </ListPagination.Root>
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
  <Suspense fallback={<ListPagination.Skeleton />}>
    <CreatorSeriesPaginationNav>
      <ListPagination.Step
        href={previousToken ? creatorDetailHref(creatorId, previousToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="storefront.common.previous_page" />
        </Suspense>
      </ListPagination.Step>
      <ListPagination.Step
        href={nextToken ? creatorDetailHref(creatorId, nextToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="storefront.common.next_page" />
        </Suspense>
      </ListPagination.Step>
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
        <EmptyState.Root>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="storefront.creators.series_empty" />
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Root>
      );
    }

    // The covers this page pointed at are gone. The server hands back a token
    // for the neighbouring page when it can, and empty tokens when it cannot —
    // then the only way out is the first page (`proto/README.md`).
    return (
      <div className="grid gap-8">
        <EmptyState.Root>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="storefront.series.page_empty" />
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Root>
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
                <Message message="storefront.creators.series_first_page" />
              </Suspense>
            </LocaleLink>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <SeriesShelf.Root locale={locale} series={creator.series} />
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
  const [rawParams, tenantId, locale] = await Promise.all([
    params,
    getTenantId(),
    getLocale(),
  ]);
  const parsedParams = parseRouteParams(creatorDetailParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { creator_id } = parsedParams;

  // The creator is looked up from the path alone, before `searchParams` is
  // awaited: a `notFound()` that runs while the route is prerendered answers
  // 404, and one behind request data streams into a response already sent
  // with 200. A failed read is a value, not a throw: a `"use cache"` fill that
  // throws fails the whole request, so neither this page nor any boundary
  // would get to render anything.
  const firstPage = await loadPublishedCreatorDetail(
    tenantId,
    creator_id,
    locale,
    ""
  );

  if (!firstPage.ok) {
    return <PageLoadError description={firstPage.message} />;
  }

  if (!firstPage.value) {
    notFound();
  }

  const { token } = parseCreatorDetailSearchParams(await searchParams);
  const result = token
    ? await loadPublishedCreatorDetail(tenantId, creator_id, locale, token)
    : firstPage;

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  const creator = result.value;

  if (!creator) {
    notFound();
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
      <Suspense fallback={null}>
        <JsonLd build={(site) => creatorJsonLd(site, creator)} />
        <JsonLd
          build={(site, t) =>
            breadcrumbJsonLd(site, [
              { href: "/creators", name: t("storefront.creators.list_title") },
              { href: `/creators/${creator.id}`, name: creator.name },
            ])
          }
        />
      </Suspense>
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
                  message="storefront.common.series_count"
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
              <Message message="storefront.creators.profile_empty" />
            </Suspense>
          </p>
        )}

        <div>
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="storefront.follow.control_error" />
              </Suspense>
            }
          >
            <Suspense fallback={<FollowControlSkeleton />}>
              <FollowControl
                targetId={creator.internalId}
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
              <Message message="storefront.creators.series_heading" />
            </Suspense>
          </h2>
          <p className="text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="storefront.creators.series_description" />
            </Suspense>
          </p>
        </div>

        <Suspense fallback={<SeriesShelf.Skeleton />}>
          <CreatorRelatedSeries creator={creator} token={token} />
        </Suspense>
      </section>

      <p>
        <LocaleLink
          className="text-sm text-primary underline underline-offset-4"
          href="/creators"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="storefront.creators.back_to_list" />
          </Suspense>
        </LocaleLink>
      </p>
    </div>
  );
};

const Page = (props: CreatorDetailPageProps) => (
  <Suspense fallback={<CreatorDetailSkeleton />}>
    <CreatorDetailContent {...props} />
  </Suspense>
);

export default Page;
