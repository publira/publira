import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Badge } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
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

import type { SeriesListItem } from "../series-types";

type SeriesManagerProps = CursorPageHrefs & {
  series: SeriesListItem[];
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
  timeZone: string;
};

const getStatusTone = (isPublished: boolean) =>
  isPublished ? ("info" as const) : ("muted" as const);

const getStatusLabel = (
  messages: ReturnType<typeof sharedCatalog>,
  isPublished: boolean
) =>
  isPublished
    ? getMessage(messages, "admin.series.published")
    : getMessage(messages, "admin.series.draft");

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
              <Badge tone={getStatusTone(item.isPublished)}>
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
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>
            {getMessage(messages, "admin.series.list_title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.series.list_description")}
          </CardDescription>
        </div>
        <LinkButton href="/series/new" variant="outline">
          {getMessage(messages, "admin.series.new_action")}
        </LinkButton>
      </CardHeader>
      <CardContent className="grid gap-4">
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
      </CardContent>
    </Card>
  );
};
