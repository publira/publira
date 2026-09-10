import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
} from "@publira/ui-components/empty-state";
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
import {
  ListPagination,
  ListPaginationSkeleton,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { PageLoadError } from "#components/page-load-error";
import { SeriesShelf, SeriesShelfSkeleton } from "#components/series-shelf";
import { getPublishedLabelDetail } from "#lib/labels";
import type { PublishedLabelDetail } from "#lib/labels";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

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
 * entries and hits the RPC twice.
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
  searchParams,
}: LabelDetailPageProps): Promise<Metadata> => {
  const [{ label_id }, tenantId, resolvedSearchParams, locale] =
    await Promise.all([params, getTenantId(), searchParams, getLocale()]);

  guardPlaceholders({ label_id });

  const labelId = parseLabelDetailParams({ label_id });
  const { token } = parseLabelDetailSearchParams(resolvedSearchParams);

  const [result, messages] = await Promise.all([
    labelId
      ? loadPublishedLabelDetail(tenantId, labelId, locale, token)
      : { ok: true as const, value: null },
    loadHostMessages(locale),
  ]);

  // An unavailable label reads as "not found" for the `<title>` alone; the
  // page body below says what actually happened.
  const label = result.ok ? result.value : null;

  if (!label) {
    return {
      title: getMessage(messages, "host.labels.not_found_title"),
    };
  }

  return {
    description: getMessage(messages, "host.labels.detail_description", {
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
    <SeriesShelfSkeleton />
  </div>
);

/**
 * The pagination's `<nav>`, and the one component on this screen that resolves
 * the catalog: an `aria-label` cannot be a node. The key stays written out
 * here, beside the `getMessage` that reads it.
 */
const LabelSeriesPaginationNav = async ({
  children,
}: {
  children: ReactNode;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <ListPagination
      aria-label={getMessage(messages, "host.labels.series_pagination_aria")}
    >
      {children}
    </ListPagination>
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
  <Suspense fallback={<ListPaginationSkeleton />}>
    <LabelSeriesPaginationNav>
      <ListPaginationStep
        href={previousToken ? labelDetailHref(labelId, previousToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep
        href={nextToken ? labelDetailHref(labelId, nextToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
        </Suspense>
      </ListPaginationStep>
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
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.labels.series_empty" />
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
                <Message message="host.labels.series_first_page" />
              </Suspense>
            </LocaleLink>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <SeriesShelf locale={locale} series={label.series} />
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
  const [{ label_id }, tenantId, resolvedSearchParams, locale] =
    await Promise.all([params, getTenantId(), searchParams, getLocale()]);

  guardPlaceholders({ label_id });

  const labelId = parseLabelDetailParams({ label_id });
  const { token } = parseLabelDetailSearchParams(resolvedSearchParams);

  if (!labelId) {
    notFound();
  }

  // A failed read is a value, not a throw: a `"use cache"` fill that throws
  // fails the whole request, so neither this page nor any boundary would get
  // to render anything.
  const result = await loadPublishedLabelDetail(
    tenantId,
    labelId,
    locale,
    token
  );

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  const label = result.value;

  if (!label) {
    notFound();
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
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
                message="host.common.series_count"
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
              <Message message="host.labels.series_heading" />
            </Suspense>
          </h2>
          <p className="text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.labels.series_description" />
            </Suspense>
          </p>
        </div>

        <Suspense fallback={<SeriesShelfSkeleton />}>
          <LabelRelatedSeries label={label} token={token} />
        </Suspense>
      </section>

      <p>
        <LocaleLink
          className="text-sm text-primary underline underline-offset-4"
          href="/labels"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="host.labels.back_to_list" />
          </Suspense>
        </LocaleLink>
      </p>
    </main>
  );
};

const Page = (props: LabelDetailPageProps) => (
  <Suspense fallback={<LabelDetailSkeleton />}>
    <LabelDetailContent {...props} />
  </Suspense>
);

export default Page;
