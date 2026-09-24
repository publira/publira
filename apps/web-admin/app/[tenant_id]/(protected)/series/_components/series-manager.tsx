import type { Locale } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import { Button, LinkButton } from "@publira/ui-components/button";
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
import { PaginationFooter } from "#components/pagination-controls";
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
  filters: SeriesFilters;
  series: SeriesListItem[];
  listErrorMessage?: string;
  locale: Locale;
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

const getStatusTone = (isPublished: boolean) =>
  isPublished ? ("info" as const) : ("muted" as const);

/**
 * The published / draft badge, as its own async component: the label is a
 * string the catalog resolves, and a row rendered inside `.map()` cannot await.
 */
const SeriesStatusLabel = async ({
  isPublished,
  locale,
}: {
  isPublished: boolean;
  locale: Locale;
}) => {
  const t = await getMessagesFor(locale);

  return isPublished ? t("admin.series.published") : t("admin.series.draft");
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
  hasPageLinks,
  itemLabel,
  listErrorMessage,
  locale,
  series,
  timeZone,
}: {
  hasPageLinks: boolean;
  /**
   * What the list holds, for the empty state's sentence. The async parent
   * resolves it so this body can stay synchronous.
   */
  itemLabel: string;
  listErrorMessage?: string;
  locale: Locale;
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
      <CursorPageEmptyState
        description={
          <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
            <Message message="admin.series.empty_description" />
          </Suspense>
        }
        hasPageLinks={hasPageLinks}
        itemLabel={itemLabel}
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
            <Message message="admin.series.empty_title" />
          </Suspense>
        }
      />
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
              <Badge tone={getStatusTone(item.isPublished)} variant="outline">
                <SeriesStatusLabel
                  isPublished={item.isPublished}
                  locale={locale}
                />
              </Badge>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                <LinkButton href={`/series/${item.publicId}`} variant="outline">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.series.edit_action" />
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
  filters,
  series,
  listErrorMessage,
  nextHref,
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
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.series.title")}
        listErrorMessage={listErrorMessage}
        locale={locale}
        series={series}
        timeZone={timeZone}
      />

      {showPagination ? (
        <PaginationFooter
          ariaLabel={t("admin.series.pagination_aria")}
          description={t("admin.series.pagination_description", {
            count: pageSize,
          })}
          nextHref={nextHref}
          previousHref={previousHref}
        />
      ) : null}
    </div>
  );
};
