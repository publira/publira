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
import { SectionError } from "@publira/ui-components/section-error";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";

import type { PageListItem } from "../page-types";
import { formatPageDateTime, formatPagePath } from "../page-types";

type PageManagerProps = CursorPageHrefs & {
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
  pages: PageListItem[];
  timeZone: string;
};

const PageListBody = ({
  hasPageLinks,
  listErrorMessage,
  locale,
  pages,
  timeZone,
}: {
  hasPageLinks: boolean;
  listErrorMessage?: string;
  locale: Locale;
  pages: PageListItem[];
  timeZone: string;
}) => {
  const messages = sharedCatalog(locale);
  // A failed fetch still hands an empty `pages` array; do not show the empty
  // list state alongside the error or operators will read it as "no pages".
  if (listErrorMessage) {
    return (
      <SectionError
        description={listErrorMessage}
        title={getMessage(messages, "admin.pages.list_error")}
      />
    );
  }

  if (pages.length === 0) {
    return (
      <CursorPageEmptyState
        description={getMessage(messages, "admin.pages.empty_description")}
        hasPageLinks={hasPageLinks}
        itemLabel={getMessage(messages, "admin.pages.title")}
        title={getMessage(messages, "admin.pages.empty_title")}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            {getMessage(messages, "admin.pages.columns.title")}
          </TableHead>
          <TableHead>
            {getMessage(messages, "admin.pages.columns.slug")}
          </TableHead>
          <TableHead className="w-32">
            {getMessage(messages, "admin.pages.columns.status")}
          </TableHead>
          <TableHead className="w-28">
            {getMessage(messages, "admin.pages.columns.footer")}
          </TableHead>
          <TableHead className="w-40">
            {getMessage(messages, "admin.pages.columns.updated_at")}
          </TableHead>
          <TableHead className="w-32">
            {getMessage(messages, "admin.pages.columns.actions")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pages.map((page) => (
          <TableRow key={page.id}>
            <TableCell className="font-medium">{page.title}</TableCell>
            <TableCell>{formatPagePath(page.slug)}</TableCell>
            <TableCell>
              <Badge
                tone={page.publishedVersionId.length > 0 ? "info" : "muted"}
              >
                {page.publishedVersionId.length > 0
                  ? getMessage(messages, "admin.pages.published")
                  : getMessage(messages, "admin.pages.draft")}
              </Badge>
            </TableCell>
            <TableCell>
              {page.displayInFooter ? (
                <Badge tone="info">
                  {getMessage(messages, "admin.pages.visible")}
                </Badge>
              ) : (
                <Badge tone="muted">
                  {getMessage(messages, "admin.pages.hidden")}
                </Badge>
              )}
            </TableCell>
            <TableCell>
              {formatPageDateTime(page.updatedAt, timeZone)}
            </TableCell>
            <TableCell>
              <LinkButton href={`/pages/${page.id}`} variant="outline">
                {getMessage(messages, "admin.pages.edit_action")}
              </LinkButton>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export const PageManager = ({
  listErrorMessage,
  nextHref,
  pageSize,
  pages,
  previousHref,
  timeZone,
  locale,
}: PageManagerProps) => {
  const messages = sharedCatalog(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (pages.length > 0 || hasPageLinks);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>
            {getMessage(messages, "admin.pages.list_title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.pages.list_description")}
          </CardDescription>
        </div>
        <LinkButton href="/pages/new" variant="outline">
          {getMessage(messages, "admin.pages.new_action")}
        </LinkButton>
      </CardHeader>
      <CardContent className="grid gap-4">
        <PageListBody
          hasPageLinks={hasPageLinks}
          listErrorMessage={listErrorMessage}
          locale={locale}
          pages={pages}
          timeZone={timeZone}
        />

        {showPagination ? (
          <PaginationFooter
            ariaLabel={getMessage(messages, "admin.pages.pagination_aria")}
            description={getMessage(
              messages,
              "admin.pages.pagination_description",
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
