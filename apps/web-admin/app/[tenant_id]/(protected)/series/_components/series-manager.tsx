import { Badge } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { SectionError } from "@publira/ui-components/section-error";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";

import { useAdminMessage } from "#components/client-message";
import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";

import type { SeriesListItem } from "../series-types";

type SeriesManagerProps = CursorPageHrefs & {
  series: SeriesListItem[];
  listErrorMessage?: string;
  pageSize: number;
  timeZone: string;
};

const getStatusTone = (isPublished: boolean) =>
  isPublished ? ("info" as const) : ("muted" as const);

const getStatusLabel = (
  t: ReturnType<typeof useAdminMessage>,
  isPublished: boolean
) => (isPublished ? t("admin.series.published") : t("admin.series.draft"));

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
  series,
  timeZone,
}: {
  hasPageLinks: boolean;
  listErrorMessage?: string;
  series: SeriesListItem[];
  timeZone: string;
}) => {
  const t = useAdminMessage();
  // A failed fetch still hands an empty `series` array; do not show the empty
  // list state alongside the error or operators will read it as "no series".
  if (listErrorMessage) {
    return (
      <SectionError
        description={listErrorMessage}
        title={t("admin.series.list_error")}
      />
    );
  }

  if (series.length === 0) {
    return (
      <CursorPageEmptyState
        description={t("admin.series.empty_description")}
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.series.title")}
        title={t("admin.series.empty_title")}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("admin.series.columns.title")}</TableHead>
          <TableHead>{t("admin.series.columns.label")}</TableHead>
          <TableHead className="w-44">
            {t("admin.series.columns.published_at")}
          </TableHead>
          <TableHead className="w-40">
            {t("admin.series.columns.reading_period")}
          </TableHead>
          <TableHead>{t("admin.series.columns.synopsis")}</TableHead>
          <TableHead className="w-32">
            {t("admin.series.columns.status")}
          </TableHead>
          <TableHead className="w-56">
            {t("admin.series.columns.actions")}
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
                timeZone,
              })}
            </TableCell>
            <TableCell>{item.readingPeriodHours}</TableCell>
            <TableCell>{excerpt(item.synopsis)}</TableCell>
            <TableCell>
              <Badge tone={getStatusTone(item.isPublished)}>
                {getStatusLabel(t, item.isPublished)}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                <LinkButton href={`/series/${item.publicId}`} variant="outline">
                  {t("admin.series.edit_action")}
                </LinkButton>
                <LinkButton
                  href={`/series/${item.publicId}/episodes`}
                  variant="outline"
                >
                  {t("admin.series.episodes_action")}
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
}: SeriesManagerProps) => {
  const t = useAdminMessage();
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (series.length > 0 || hasPageLinks);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>{t("admin.series.list_title")}</CardTitle>
          <CardDescription>
            {t("admin.series.list_description")}
          </CardDescription>
        </div>
        <LinkButton href="/series/new" variant="outline">
          {t("admin.series.new_action")}
        </LinkButton>
      </CardHeader>
      <CardContent className="grid gap-4">
        <SeriesListBody
          hasPageLinks={hasPageLinks}
          listErrorMessage={listErrorMessage}
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
      </CardContent>
    </Card>
  );
};
