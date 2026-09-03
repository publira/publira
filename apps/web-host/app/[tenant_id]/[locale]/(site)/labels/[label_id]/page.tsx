import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { ImageIcon } from "@publira/icons";
import {
  createPlaceholderStaticParams,
  guardPlaceholders,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EyeCatchPicture } from "#components/eye-catch-picture";
import { LocaleLink } from "#components/locale-link";
import { PageLoadError } from "#components/page-load-error";
import { getPublishedLabelDetail } from "#lib/labels";
import type { PublishedLabelDetail } from "#lib/labels";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteLabel } from "#lib/tenant";
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
  <div className="mx-auto max-w-5xl px-6 py-12">
    <div className="mb-10 overflow-hidden rounded-3xl border border-border/70 bg-card/90 shadow-sm">
      <div className="aspect-video animate-pulse bg-muted" />
      <div className="space-y-4 p-8">
        <div className="h-9 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
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

const LabelSeriesPagination = async ({
  labelId,
  nextToken,
  previousToken,
}: {
  labelId: string;
  nextToken: string;
  previousToken: string;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <nav
      aria-label={getMessage(messages, "host.labels.series_pagination_aria")}
      className="mt-8 flex items-center justify-center gap-6"
    >
      {previousToken ? (
        <LocaleLink
          href={labelDetailHref(labelId, previousToken)}
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
          href={labelDetailHref(labelId, nextToken)}
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

const LabelRelatedSeries = async ({
  label,
  token,
}: {
  label: PublishedLabelDetail;
  token: string;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  if (label.series.length === 0) {
    if (!token) {
      return (
        <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-6 text-sm text-muted-foreground">
          {getMessage(messages, "host.labels.series_empty")}
        </div>
      );
    }

    return (
      <div className="py-10 text-center">
        <p className="mb-4 text-sm text-muted-foreground">
          {getMessage(messages, "host.series.page_empty")}
        </p>
        {label.previousToken || label.nextToken ? (
          <LabelSeriesPagination
            labelId={label.id}
            nextToken={label.nextToken}
            previousToken={label.previousToken}
          />
        ) : (
          <LocaleLink
            href={labelDetailHref(label.id, "")}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {getMessage(messages, "host.labels.series_first_page")}
          </LocaleLink>
        )}
      </div>
    );
  }

  return (
    <>
      <ul className="grid gap-4">
        {label.series.map((series) => (
          <li key={series.publicId}>
            <LocaleLink
              href={`/series/${series.publicId}`}
              className="block rounded-2xl border border-border/70 bg-card p-5 transition hover:border-secondary/40 hover:shadow-sm"
            >
              <p className="font-medium text-foreground">{series.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {getMessage(messages, "host.common.view_series_detail")}
              </p>
            </LocaleLink>
          </li>
        ))}
      </ul>
      <LabelSeriesPagination
        labelId={label.id}
        nextToken={label.nextToken}
        previousToken={label.previousToken}
      />
    </>
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
  const [siteLabel, result, messages] = await Promise.all([
    getTenantSiteLabel(tenantId, locale),
    loadPublishedLabelDetail(tenantId, labelId, locale, token),
    loadHostMessages(locale),
  ]);

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  const label = result.value;

  if (!label) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <section className="mb-10 overflow-hidden rounded-3xl border border-border/70 bg-card/90 shadow-sm">
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
            <ImageIcon className="h-16 w-16" />
          </div>
        )}
        <div className="p-8">
          <p className="mb-3 text-xs tracking-[0.24em] text-muted-foreground uppercase">
            {siteLabel}
          </p>
          <h1 className="mb-2 font-serif text-4xl font-bold text-foreground">
            {label.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {getMessage(messages, "host.common.series_count", {
              count: label.seriesCount,
            })}
          </p>
        </div>
      </section>

      <section>
        <div className="mb-5">
          <h2 className="font-serif text-2xl font-semibold">
            {getMessage(messages, "host.labels.series_heading")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {getMessage(messages, "host.labels.series_description")}
          </p>
        </div>

        <LabelRelatedSeries label={label} token={token} />
      </section>

      <div className="mt-8">
        <LocaleLink
          href="/labels"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {getMessage(messages, "host.labels.back_to_list")}
        </LocaleLink>
      </div>
    </main>
  );
};

const Page = (props: LabelDetailPageProps) => (
  <Suspense fallback={<LabelDetailSkeleton />}>
    <LabelDetailContent {...props} />
  </Suspense>
);

export default Page;
