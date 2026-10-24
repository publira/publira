import type { Locale } from "@publira/i18n";
import * as EmptyState from "@publira/ui-components/empty-state";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  createPlaceholderStaticParams,
  guardPlaceholders,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { EyeCatchPicture } from "#components/eye-catch-picture";
import { JsonLd } from "#components/json-ld";
import * as ListPagination from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { PageLoadError } from "#components/page-load-error";
import * as SeriesShelf from "#components/series-shelf";
import { getMessages } from "#lib/get-messages";
import { breadcrumbJsonLd } from "#lib/json-ld";
import { getPublishedLabelDetail } from "#lib/labels";
import type { PublishedLabelDetail } from "#lib/labels";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { tenantLocaleAlternates } from "#lib/tenant-locale-path";

import {
  labelDetailHref,
  parseLabelDetailParams,
  parseLabelDetailSearchParams,
} from "./_lib/search-params";

const LABEL_SERIES_PAGE_SIZE = 20;

type LabelDetailPageProps =
  PageProps<"/[tenant_id]/[locale]/labels/[label_id]">;

/**
 * `"use cache"` keys on the serialized arguments, so metadata and the page
 * body have to pass the same `{ limit, token }` or one request fills two
 * entries and hits the RPC twice. Both look the label up on its first page,
 * which needs nothing but the path.
 */
const loadPublishedLabelDetail = (
  tenantId: string,
  labelId: string,
  locale: Locale,
  token: string
) =>
  getPublishedLabelDetail(tenantId, labelId, {
    limit: LABEL_SERIES_PAGE_SIZE,
    locale,
    token,
  });

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "label_id");

export const generateMetadata = async ({
  params,
}: LabelDetailPageProps): Promise<Metadata> => {
  const [{ label_id }, tenantId, locale] = await Promise.all([
    params,
    getTenantId(),
    getLocale(),
  ]);

  guardPlaceholders({ label_id });

  const labelId = parseLabelDetailParams({ label_id });

  const [result, t, alternates] = await Promise.all([
    labelId
      ? loadPublishedLabelDetail(tenantId, labelId, locale, "")
      : { ok: true as const, value: null },
    getMessagesFor(locale),
    tenantLocaleAlternates(tenantId, locale, `/labels/${label_id}`),
  ]);

  // An unavailable label reads as "not found" for the `<title>` alone; the
  // page body below says what actually happened.
  const label = result.ok ? result.value : null;

  if (!label) {
    return {
      title: t("storefront.labels.not_found_title"),
    };
  }

  return {
    alternates,
    description: t("storefront.labels.detail_description", {
      count: label.seriesCount,
      name: label.name,
    }),
    title: label.name,
  };
};

const LabelDetailSkeleton = () => (
  <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
    <div className="grid gap-2">
      <SkeletonLine className="h-8 w-1/2" />
      <SkeletonLine className="h-4 w-40" />
    </div>
    <SeriesShelf.Skeleton />
  </div>
);

/**
 * The pagination's `<nav>`, and the one component on this screen that resolves
 * the accessor: an `aria-label` cannot be a node. The key stays written out
 * here, beside the call that reads it.
 */
const LabelSeriesPaginationNav = async ({
  children,
}: {
  children: ReactNode;
}) => {
  const t = await getMessages();

  return (
    <ListPagination.Root
      aria-label={t("storefront.labels.series_pagination_aria")}
    >
      {children}
    </ListPagination.Root>
  );
};

const LabelSeriesPagination = ({
  labelId,
  nextToken,
  previousToken,
}: {
  labelId: string;
  nextToken: string;
  previousToken: string;
}) => (
  <Suspense fallback={<ListPagination.Skeleton />}>
    <LabelSeriesPaginationNav>
      <ListPagination.Step
        href={previousToken ? labelDetailHref(labelId, previousToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="storefront.common.previous_page" />
        </Suspense>
      </ListPagination.Step>
      <ListPagination.Step
        href={nextToken ? labelDetailHref(labelId, nextToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="storefront.common.next_page" />
        </Suspense>
      </ListPagination.Step>
    </LabelSeriesPaginationNav>
  </Suspense>
);

const LabelRelatedSeries = async ({
  label,
  token,
}: {
  label: PublishedLabelDetail;
  token: string;
}) => {
  const locale = await getLocale();

  if (label.series.length === 0) {
    if (!token) {
      return (
        <EmptyState.Root>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="storefront.labels.series_empty" />
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
        {label.previousToken || label.nextToken ? (
          <LabelSeriesPagination
            labelId={label.id}
            nextToken={label.nextToken}
            previousToken={label.previousToken}
          />
        ) : (
          <p>
            <LocaleLink
              className="text-sm text-primary underline underline-offset-4"
              href={labelDetailHref(label.id, "")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="storefront.labels.series_first_page" />
              </Suspense>
            </LocaleLink>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <SeriesShelf.Root locale={locale} series={label.series} />
      <LabelSeriesPagination
        labelId={label.id}
        nextToken={label.nextToken}
        previousToken={label.previousToken}
      />
    </div>
  );
};

const LabelDetailContent = async ({
  params,
  searchParams,
}: LabelDetailPageProps) => {
  const [{ label_id }, tenantId, locale] = await Promise.all([
    params,
    getTenantId(),
    getLocale(),
  ]);

  guardPlaceholders({ label_id });

  const labelId = parseLabelDetailParams({ label_id });

  if (!labelId) {
    notFound();
  }

  // The label is looked up from the path alone, before `searchParams` is
  // awaited: a `notFound()` that runs while the route is prerendered answers
  // 404, and one behind request data streams into a response already sent
  // with 200. A failed read is a value, not a throw: a `"use cache"` fill that
  // throws fails the whole request, so neither this page nor any boundary
  // would get to render anything.
  const firstPage = await loadPublishedLabelDetail(
    tenantId,
    labelId,
    locale,
    ""
  );

  if (!firstPage.ok) {
    return <PageLoadError description={firstPage.message} />;
  }

  if (!firstPage.value) {
    notFound();
  }

  const { token } = parseLabelDetailSearchParams(await searchParams);
  const result = token
    ? await loadPublishedLabelDetail(tenantId, labelId, locale, token)
    : firstPage;

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  const label = result.value;

  if (!label) {
    notFound();
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
      <Suspense fallback={null}>
        <JsonLd
          build={(site, t) =>
            breadcrumbJsonLd(site, [
              { href: "/labels", name: t("storefront.labels.list_title") },
              { href: `/labels/${labelId}`, name: label.name },
            ])
          }
        />
      </Suspense>
      <div className="grid gap-4">
        {label.eyeCatchImageVariants &&
          label.eyeCatchImageVariants.length > 0 && (
            <span className="block overflow-hidden rounded-surface bg-muted">
              <EyeCatchPicture
                alt=""
                imgClassName="aspect-video size-full object-cover"
                sizes="(max-width: 1200px) 100vw, 1152px"
                variants={label.eyeCatchImageVariants}
              />
            </span>
          )}
        <div className="grid gap-2">
          <h1 className="font-serif text-3xl leading-tight">{label.name}</h1>
          <p className="text-sm text-muted-foreground tabular-nums">
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message
                message="storefront.common.series_count"
                values={{ count: label.seriesCount }}
              />
            </Suspense>
          </p>
        </div>
      </div>

      <section className="grid gap-4">
        <div className="grid gap-1 border-b border-border pb-2">
          <h2 className="font-serif text-xl leading-tight">
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="storefront.labels.series_heading" />
            </Suspense>
          </h2>
          <p className="text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="storefront.labels.series_description" />
            </Suspense>
          </p>
        </div>

        <Suspense fallback={<SeriesShelf.Skeleton />}>
          <LabelRelatedSeries label={label} token={token} />
        </Suspense>
      </section>

      <p>
        <LocaleLink
          className="text-sm text-primary underline underline-offset-4"
          href="/labels"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="storefront.labels.back_to_list" />
          </Suspense>
        </LocaleLink>
      </p>
    </div>
  );
};

const Page = (props: LabelDetailPageProps) => (
  <Suspense fallback={<LabelDetailSkeleton />}>
    <LabelDetailContent {...props} />
  </Suspense>
);

export default Page;
