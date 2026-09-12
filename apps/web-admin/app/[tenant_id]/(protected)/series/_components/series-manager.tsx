import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Badge } from "@publira/ui-components/badge";
import { Button, LinkButton } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
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
import type {
  SeriesAgeRatingValue,
  SeriesStatusValue,
} from "#lib/series-classification";

import type { SeriesFilters } from "../_lib/search-params";
import type { SeriesListItem } from "../series-types";

type SeriesManagerProps = CursorPageHrefs & {
  filters: SeriesFilters;
  series: SeriesListItem[];
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
  timeZone: string;
};

const SeriesFiltersForm = ({
  filters,
  messages,
}: {
  filters: SeriesFilters;
  messages: ReturnType<typeof sharedCatalog>;
}) => (
  <form className="flex flex-wrap items-end gap-4">
    <Field className="w-52">
      <FieldLabel htmlFor="series-status-filter">
        {getMessage(messages, "admin.series.filter.status")}
      </FieldLabel>
      <FieldContent>
        <select
          className="flex h-10 w-full rounded-control border border-input bg-background px-3 py-2 text-sm text-foreground"
          defaultValue={filters.status}
          id="series-status-filter"
          name="status"
        >
          <option value="">
            {getMessage(messages, "admin.series.filter.status_all")}
          </option>
          <option value="ongoing">
            {getMessage(messages, "admin.series.status.ongoing")}
          </option>
          <option value="completed">
            {getMessage(messages, "admin.series.status.completed")}
          </option>
          <option value="hiatus">
            {getMessage(messages, "admin.series.status.hiatus")}
          </option>
        </select>
      </FieldContent>
    </Field>
    <Field className="w-52">
      <FieldLabel htmlFor="series-age-rating-filter">
        {getMessage(messages, "admin.series.filter.age_rating")}
      </FieldLabel>
      <FieldContent>
        <select
          className="flex h-10 w-full rounded-control border border-input bg-background px-3 py-2 text-sm text-foreground"
          defaultValue={filters.ageRating}
          id="series-age-rating-filter"
          name="age_rating"
        >
          <option value="">
            {getMessage(messages, "admin.series.filter.age_rating_all")}
          </option>
          <option value="all">
            {getMessage(messages, "admin.series.age_rating.all")}
          </option>
          <option value="r15">
            {getMessage(messages, "admin.series.age_rating.r15")}
          </option>
          <option value="r18">
            {getMessage(messages, "admin.series.age_rating.r18")}
          </option>
        </select>
      </FieldContent>
    </Field>
    <div className="flex gap-2">
      <Button type="submit">
        {getMessage(messages, "admin.series.filter.apply")}
      </Button>
      <LinkButton href="/series" variant="outline">
        {getMessage(messages, "admin.series.filter.reset")}
      </LinkButton>
    </div>
  </form>
);

const getStatusTone = (isPublished: boolean) =>
  isPublished ? ("info" as const) : ("muted" as const);

const getStatusLabel = (
  messages: ReturnType<typeof sharedCatalog>,
  isPublished: boolean
) =>
  isPublished
    ? getMessage(messages, "admin.series.published")
    : getMessage(messages, "admin.series.draft");

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
  listErrorMessage,
  locale,
  series,
  timeZone,
}: {
  hasPageLinks: boolean;
  listErrorMessage?: string;
  locale: Locale;
  series: SeriesListItem[];
  timeZone: string;
}) => {
  const messages = sharedCatalog(locale);
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
        description={getMessage(messages, "admin.series.empty_description")}
        hasPageLinks={hasPageLinks}
        itemLabel={getMessage(messages, "admin.series.title")}
        title={getMessage(messages, "admin.series.empty_title")}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            {getMessage(messages, "admin.series.columns.title")}
          </TableHead>
          <TableHead>
            {getMessage(messages, "admin.series.columns.label")}
          </TableHead>
          <TableHead className="w-44">
            {getMessage(messages, "admin.series.columns.published_at")}
          </TableHead>
          <TableHead className="w-40">
            {getMessage(messages, "admin.series.columns.reading_period")}
          </TableHead>
          <TableHead>
            {getMessage(messages, "admin.series.columns.synopsis")}
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
            {getMessage(messages, "admin.series.columns.status")}
          </TableHead>
          <TableHead className="w-56">
            {getMessage(messages, "admin.series.columns.actions")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {series.map((item) => (
          <TableRow key={item.publicId}>
            <TableCell className="font-medium">{item.title}</TableCell>
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
                {getStatusLabel(messages, item.isPublished)}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                <LinkButton href={`/series/${item.publicId}`} variant="outline">
                  {getMessage(messages, "admin.series.edit_action")}
                </LinkButton>
                <LinkButton
                  href={`/series/${item.publicId}/episodes`}
                  variant="outline"
                >
                  {getMessage(messages, "admin.series.episodes_action")}
                </LinkButton>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export const SeriesManager = ({
  filters,
  series,
  listErrorMessage,
  nextHref,
  pageSize,
  previousHref,
  timeZone,
  locale,
}: SeriesManagerProps) => {
  const messages = sharedCatalog(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (series.length > 0 || hasPageLinks);

  return (
    <div className="grid gap-6">
      <SeriesFiltersForm filters={filters} messages={messages} />
      <SeriesListBody
        hasPageLinks={hasPageLinks}
        listErrorMessage={listErrorMessage}
        locale={locale}
        series={series}
        timeZone={timeZone}
      />

      {showPagination ? (
        <PaginationFooter
          ariaLabel={getMessage(messages, "admin.series.pagination_aria")}
          description={getMessage(
            messages,
            "admin.series.pagination_description",
            {
              count: pageSize,
            }
          )}
          nextHref={nextHref}
          previousHref={previousHref}
        />
      ) : null}
    </div>
  );
};
