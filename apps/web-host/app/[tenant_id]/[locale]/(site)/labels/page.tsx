import { getMessage } from "@publira/i18n";
import { ImageIcon } from "@publira/icons";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EyeCatchPicture } from "#components/eye-catch-picture";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listPublishedLabels } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  labelsListHref,
  parseLabelsListSearchParams,
} from "./_lib/search-params";

const LABELS_PAGE_SIZE = 24;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.labels.list_title") };
};

const LabelsListSkeleton = () => (
  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: 6 }, (_, i) => (
      <div
        key={i}
        className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm"
      >
        <div className="aspect-video animate-pulse bg-muted" />
        <div className="p-4">
          <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      </div>
    ))}
  </div>
);

/**
 * The tenant's name sits inside the sentence, and the two locales put it in
 * different places, so the whole line resolves at once rather than streaming
 * the name into a fixed frame.
 */
const LabelsListDescription = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [siteLabel, messages] = await Promise.all([
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);

  return getMessage(messages, "host.labels.list_description", {
    site: siteLabel,
  });
};

const LabelsPagination = async ({
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
      aria-label={getMessage(messages, "host.labels.pagination_aria")}
      className="mt-8 flex items-center justify-center gap-6"
    >
      {previousToken ? (
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={labelsListHref(previousToken)}
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
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={labelsListHref(nextToken)}
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

const LabelsListData = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/[locale]/labels">["searchParams"];
}) => {
  const [resolvedSearchParams, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const { token } = parseLabelsListSearchParams(resolvedSearchParams);
  const [result, messages] = await Promise.all([
    listPublishedLabels(tenantId, {
      limit: LABELS_PAGE_SIZE,
      locale,
      token,
    }),
    loadHostMessages(locale),
  ]);

  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.labels.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const { labels, nextToken, previousToken } = result.value;

  if (labels.length === 0) {
    if (!token) {
      return (
        <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          {getMessage(messages, "host.labels.list_empty")}
        </p>
      );
    }

    // The rows this page pointed at are gone. The server hands back a token for
    // the neighbouring page when it can, and empty tokens when it cannot — then
    // the only way out is the first page (`proto/README.md`).
    return (
      <div className="py-20 text-center">
        <p className="mb-4 text-muted-foreground">
          {getMessage(messages, "host.labels.page_empty")}
        </p>
        {previousToken || nextToken ? (
          <LabelsPagination
            nextToken={nextToken}
            previousToken={previousToken}
          />
        ) : (
          <LocaleLink
            className="text-sm text-primary underline-offset-4 hover:underline"
            href={labelsListHref("")}
          >
            {getMessage(messages, "host.labels.first_page")}
          </LocaleLink>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {labels.map((label) => (
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
                <ImageIcon className="h-12 w-12" />
              </div>
            )}
            <div className="p-4">
              <h2 className="font-serif text-lg font-semibold">{label.name}</h2>
            </div>
          </LocaleLink>
        ))}
      </div>

      <LabelsPagination nextToken={nextToken} previousToken={previousToken} />
    </>
  );
};

const LabelsPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/labels">) => (
  <main className="mx-auto max-w-6xl px-6 py-12">
    <h1 className="mb-2 font-serif text-4xl font-bold">
      <Suspense fallback={<SkeletonLine className="h-9 w-56" />}>
        <Message message="host.labels.list_title" />
      </Suspense>
    </h1>
    <p className="mb-8 text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-5 w-80" />}>
        <LabelsListDescription />
      </Suspense>
    </p>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="host.labels.list_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<LabelsListSkeleton />}>
        <LabelsListData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default LabelsPage;
