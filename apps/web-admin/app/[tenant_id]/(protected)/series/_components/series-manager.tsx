import type { Locale } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import { Button, LinkButton } from "@publira/ui-components/button";
import {
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import {
  PaginationControls,
  PaginationFooter,
  PaginationFooterDescription,
} from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";
import type {
  SeriesAgeRatingValue,
  SeriesStatusValue,
} from "#lib/series-classification";

import type { SeriesFilters } from "../_lib/search-params";
import type { SeriesListItem } from "../series-types";
import { SeriesAvailabilityBadge } from "./series-availability-badge";

type SeriesManagerProps = CursorPageHrefs & {
  /**
   * Whether the operator may edit the series, which decides whether a row
   * offers to edit it or only to view it.
   */
  canEdit: boolean;
  filters: SeriesFilters;
  series: SeriesListItem[];
  listErrorMessage?: string;
  locale: Locale;
  /**
   * The instant the list is read at, which tells a series already live from
   * one whose publication time is still ahead.
   */
  now: Temporal.Instant;
  pageSize: number;
  timeZone: string;
};

const SeriesFilterFieldSkeleton = () => (
  <div className="grid gap-2">
    <SkeletonLine className="h-4 w-24" />
    <SkeletonLine className="h-10 w-52" />
  </div>
);

const SeriesStatusFilter = async ({
  filters,
  locale,
}: {
  filters: SeriesFilters;
  locale: Locale;
}) => {
  const t = await getMessagesFor(locale);

  return (
    <Field className="w-52">
      <FieldLabel>{t("admin.series.filter.status")}</FieldLabel>
      <FieldContent>
        <Select
          defaultValue={filters.status}
          items={[
            { label: t("admin.series.filter.status_all"), value: "" },
            { label: t("admin.series.status.ongoing"), value: "ongoing" },
            { label: t("admin.series.status.completed"), value: "completed" },
            { label: t("admin.series.status.hiatus"), value: "hiatus" },
          ]}
          name="status"
        />
      </FieldContent>
    </Field>
  );
};

const SeriesAgeRatingFilter = async ({
  filters,
  locale,
}: {
  filters: SeriesFilters;
  locale: Locale;
}) => {
  const t = await getMessagesFor(locale);

  return (
    <Field className="w-52">
      <FieldLabel>{t("admin.series.filter.age_rating")}</FieldLabel>
      <FieldContent>
        <Select
          defaultValue={filters.ageRating}
          items={[
            { label: t("admin.series.filter.age_rating_all"), value: "" },
            { label: t("admin.series.age_rating.all"), value: "all" },
            { label: t("admin.series.age_rating.r15"), value: "r15" },
            { label: t("admin.series.age_rating.r18"), value: "r18" },
          ]}
          name="age_rating"
        />
      </FieldContent>
    </Field>
  );
};

const SeriesFiltersForm = ({
  filters,
  locale,
}: {
  filters: SeriesFilters;
  locale: Locale;
}) => (
  <form className="flex flex-wrap items-end gap-4">
    <Suspense fallback={<SeriesFilterFieldSkeleton />}>
      <SeriesStatusFilter filters={filters} locale={locale} />
    </Suspense>
    <Suspense fallback={<SeriesFilterFieldSkeleton />}>
      <SeriesAgeRatingFilter filters={filters} locale={locale} />
    </Suspense>
    <div className="flex gap-2">
      <Button type="submit">
        <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
          <Message message="admin.series.filter.apply" />
        </Suspense>
      </Button>
      <LinkButton href="/series" variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
          <Message message="admin.series.filter.reset" />
        </Suspense>
      </LinkButton>
    </div>
  </form>
);

type SeriesPublicationState = "draft" | "published" | "scheduled";

/**
 * `isPublished` holds as soon as a publication time is stored, while the site
 * keeps the series hidden until that time passes, so a time still ahead is
 * told apart here rather than read as live.
 */
const getPublicationState = (
  {
    isPublished,
    publishedAt,
  }: Pick<SeriesListItem, "isPublished" | "publishedAt">,
  now: Temporal.Instant
): SeriesPublicationState => {
  if (!isPublished) {
    return "draft";
  }
  if (
    publishedAt &&
    Temporal.Instant.compare(Temporal.Instant.from(publishedAt), now) > 0
  ) {
    return "scheduled";
  }
  return "published";
};

const STATUS_TONES = {
  draft: "muted",
  published: "info",
  scheduled: "warning",
} as const satisfies Record<SeriesPublicationState, string>;

/**
 * The published / scheduled / draft badge, as its own async component: the
 * label is a string the catalog resolves, and a row rendered inside `.map()`
 * cannot await.
 */
const SeriesStatusBadge = async ({
  locale,
  now,
  series,
}: {
  locale: Locale;
  now: Temporal.Instant;
  series: Pick<SeriesListItem, "isPublished" | "publishedAt">;
}) => {
  const t = await getMessagesFor(locale);
  const state = getPublicationState(series, now);

  // Each branch names its key literally, so the strings the list uses stay
  // findable in this file.
  let label = t("admin.series.draft");
  if (state === "published") {
    label = t("admin.series.published");
  } else if (state === "scheduled") {
    label = t("admin.series.scheduled");
  }

  return (
    <Badge tone={STATUS_TONES[state]} variant="outline">
      {label}
    </Badge>
  );
};

/**
 * The serialization state, worded one branch at a time. Each branch names its
 * key inside the `<Message>` it returns, so the key stays where anything
 * reading this file for the strings the screen uses can see it.
 */
const SeriesSerializationMessage = ({
  status,
}: {
  status: SeriesStatusValue;
}) => {
  if (status === "completed") {
    return <Message message="admin.series.status.completed" />;
  }
  if (status === "hiatus") {
    return <Message message="admin.series.status.hiatus" />;
  }
  return <Message message="admin.series.status.ongoing" />;
};

const SeriesAgeRatingMessage = ({
  ageRating,
}: {
  ageRating: SeriesAgeRatingValue;
}) => {
  if (ageRating === "r15") {
    return <Message message="admin.series.age_rating.r15" />;
  }
  if (ageRating === "r18") {
    return <Message message="admin.series.age_rating.r18" />;
  }
  return <Message message="admin.series.age_rating.all" />;
};

const excerpt = (text: string, max = 56) => {
  const normalized = text.replaceAll(/\s+/gu, " ").trim();
  if (normalized.length <= max) {
    return normalized || "-";
  }

  return `${normalized.slice(0, max)}...`;
};

const SeriesListBody = ({
  canEdit,
  hasPageLinks,
  itemLabel,
  listErrorMessage,
  locale,
  now,
  series,
  timeZone,
}: {
  canEdit: boolean;
  hasPageLinks: boolean;
  /**
   * What the list holds, for the empty state's sentence. The async parent
   * resolves it so this body can stay synchronous.
   */
  itemLabel: string;
  listErrorMessage?: string;
  locale: Locale;
  now: Temporal.Instant;
  series: SeriesListItem[];
  timeZone: string;
}) => {
  // A failed fetch still hands an empty `series` array; do not show the empty
  // list state alongside the error or operators will read it as "no series".
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.series.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (series.length === 0) {
    return (
      <CursorPageEmptyState hasPageLinks={hasPageLinks} itemLabel={itemLabel}>
        <EmptyStateHeading>
          <EmptyStateTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message message="admin.series.empty_title" />
            </Suspense>
          </EmptyStateTitle>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="admin.series.empty_description" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyStateHeading>
      </CursorPageEmptyState>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.columns.title" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.columns.label" />
            </Suspense>
          </TableHead>
          <TableHead className="w-44">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.columns.published_at" />
            </Suspense>
          </TableHead>
          <TableHead className="w-40">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.columns.reading_period" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.columns.synopsis" />
            </Suspense>
          </TableHead>
          <TableHead className="w-32">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.series.columns.serialization" />
            </Suspense>
          </TableHead>
          <TableHead className="w-28">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.series.columns.age_rating" />
            </Suspense>
          </TableHead>
          <TableHead className="w-32">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.columns.status" />
            </Suspense>
          </TableHead>
          <TableHead className="w-56">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.series.columns.actions" />
            </Suspense>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {series.map((item) => (
          <TableRow key={item.publicId}>
            <TableCell className="font-medium">
              <div className="flex flex-wrap items-center gap-2">
                <span>{item.title}</span>
                <SeriesAvailabilityBadge availability={item.availability} />
              </div>
            </TableCell>
            <TableCell>{item.labelName || "-"}</TableCell>
            <TableCell>
              {formatDateTime(item.publishedAt, {
                fallback: "-",
                locale,
                timeZone,
              })}
            </TableCell>
            <TableCell>{item.readingPeriodHours}</TableCell>
            <TableCell>{excerpt(item.synopsis)}</TableCell>
            <TableCell>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <SeriesSerializationMessage status={item.status} />
              </Suspense>
            </TableCell>
            <TableCell>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <SeriesAgeRatingMessage ageRating={item.ageRating} />
              </Suspense>
            </TableCell>
            <TableCell>
              <SeriesStatusBadge locale={locale} now={now} series={item} />
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                <LinkButton href={`/series/${item.publicId}`} variant="outline">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    {canEdit ? (
                      <Message message="admin.series.edit_action" />
                    ) : (
                      <Message message="admin.common.view_action" />
                    )}
                  </Suspense>
                </LinkButton>
                <LinkButton
                  href={`/series/${item.publicId}/episodes`}
                  variant="outline"
                >
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.series.episodes_action" />
                  </Suspense>
                </LinkButton>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export const SeriesManager = async ({
  canEdit,
  filters,
  series,
  listErrorMessage,
  nextHref,
  now,
  pageSize,
  previousHref,
  timeZone,
  locale,
}: SeriesManagerProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (series.length > 0 || hasPageLinks);

  return (
    <div className="grid gap-6">
      <SeriesFiltersForm filters={filters} locale={locale} />
      <SeriesListBody
        canEdit={canEdit}
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.series.title")}
        listErrorMessage={listErrorMessage}
        locale={locale}
        now={now}
        series={series}
        timeZone={timeZone}
      />

      {showPagination ? (
        <PaginationFooter>
          <PaginationFooterDescription>
            {t("admin.series.pagination_description", {
              count: pageSize,
            })}
          </PaginationFooterDescription>
          <PaginationControls
            aria-label={t("admin.series.pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </PaginationFooter>
      ) : null}
    </div>
  );
};
