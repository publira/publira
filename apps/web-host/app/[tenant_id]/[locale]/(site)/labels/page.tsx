import { getMessage } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
} from "@publira/ui-components/empty-state";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { EyeCatchFrame } from "#components/eye-catch-frame";
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

/** Enough rows to fill a phone screen while the read comes back. */
const LABELS_SKELETON_COUNT = 8;

/** The one style both pagination directions and the first-page link share. */
const paginationLinkClassName =
  "text-sm text-primary underline underline-offset-4";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.labels.list_title") };
};

const LabelRowsSkeleton = () => (
  <div className="divide-y divide-border border-t border-border">
    {Array.from({ length: LABELS_SKELETON_COUNT }, (_, index) => (
      <div className="flex items-center gap-4 py-3" key={index}>
        <Skeleton className="size-14 shrink-0 rounded-control" />
        <Skeleton className="h-4 w-40" />
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

/**
 * The pagination's own `<nav>`.
 *
 * `aria-label` cannot be a node, so this resolves the catalog for that one
 * attribute and nothing else. The words inside are the caller's, each behind a
 * boundary of its own, so the navigation is the largest thing one missing
 * string can hold up.
 */
const LabelsPaginationNav = async ({ children }: { children: ReactNode }) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <nav
      aria-label={getMessage(messages, "host.labels.pagination_aria")}
      className="flex items-baseline gap-6 border-t border-border pt-4"
    >
      {children}
    </nav>
  );
};

const LabelsPaginationSkeleton = () => (
  <div className="flex items-baseline gap-6 border-t border-border pt-4">
    <SkeletonLine className="h-4 w-24" />
    <SkeletonLine className="h-4 w-16" />
  </div>
);

/**
 * A cursor list has no page numbers to set in ink, so the two directions are
 * all there is to render: the one that leads somewhere is an Ai text link, and
 * the end of the list is the same words without one.
 */
const LabelsPagination = ({
  nextToken,
  previousToken,
}: {
  nextToken: string;
  previousToken: string;
}) => (
  <Suspense fallback={<LabelsPaginationSkeleton />}>
    <LabelsPaginationNav>
      {previousToken ? (
        <LocaleLink
          className={paginationLinkClassName}
          href={labelsListHref(previousToken)}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="host.common.previous_page" />
          </Suspense>
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="host.common.previous_page" />
          </Suspense>
        </span>
      )}

      {nextToken ? (
        <LocaleLink
          className={paginationLinkClassName}
          href={labelsListHref(nextToken)}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="host.common.next_page" />
          </Suspense>
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="host.common.next_page" />
          </Suspense>
        </span>
      )}
    </LabelsPaginationNav>
  </Suspense>
);

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

  const result = await listPublishedLabels(tenantId, {
    limit: LABELS_PAGE_SIZE,
    locale,
    token,
  });

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
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.labels.list_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
      );
    }

    // The rows this page pointed at are gone. The server hands back a token for
    // the neighbouring page when it can, and empty tokens when it cannot — then
    // the only way out is the first page (`proto/README.md`).
    return (
      <div className="grid gap-8">
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.labels.page_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
        {previousToken || nextToken ? (
          <LabelsPagination
            nextToken={nextToken}
            previousToken={previousToken}
          />
        ) : (
          <p>
            <LocaleLink
              className={paginationLinkClassName}
              href={labelsListHref("")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="host.labels.first_page" />
              </Suspense>
            </LocaleLink>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <ul className="divide-y divide-border border-t border-border">
        {labels.map((label) => (
          <li key={label.publicId}>
            <LocaleLink
              className="group flex items-center gap-4 py-3"
              href={`/labels/${label.publicId}`}
            >
              <EyeCatchFrame
                // The name is right beside it in the row, so the artwork
                // adds nothing a reader has not already been given.
                alt=""
                className="size-14 shrink-0 rounded-control"
                sizes="56px"
                variants={label.eyeCatchImageVariants}
              />
              <span className="min-w-0 flex-1 truncate underline-offset-4 group-hover:underline">
                {label.name}
              </span>
            </LocaleLink>
          </li>
        ))}
      </ul>

      <LabelsPagination nextToken={nextToken} previousToken={previousToken} />
    </div>
  );
};

const LabelsPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/labels">) => (
  <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
    <div className="grid gap-2">
      <h1 className="font-serif text-3xl leading-tight">
        <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
          <Message message="host.labels.list_title" />
        </Suspense>
      </h1>
      <p className="text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-5 w-80" />}>
          <LabelsListDescription />
        </Suspense>
      </p>
    </div>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="host.labels.list_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<LabelRowsSkeleton />}>
        <LabelsListData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default LabelsPage;
