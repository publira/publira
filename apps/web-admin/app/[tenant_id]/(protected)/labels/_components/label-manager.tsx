import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
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
import Link from "next/link";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";

import type { LabelListItem } from "../label-types";

type LabelManagerProps = CursorPageHrefs & {
  labels: LabelListItem[];
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
};

const LabelListBody = ({
  hasPageLinks,
  labels,
  listErrorMessage,
  locale,
}: {
  hasPageLinks: boolean;
  labels: LabelListItem[];
  listErrorMessage?: string;
  locale: Locale;
}) => {
  const messages = sharedCatalog(locale);
  // A failed fetch still hands an empty `labels` array; do not show the empty
  // list state alongside the error or operators will read it as "no labels".
  if (listErrorMessage) {
    return (
      <SectionError
        description={listErrorMessage}
        title={getMessage(messages, "admin.labels.list_error")}
      />
    );
  }

  if (labels.length === 0) {
    return (
      <CursorPageEmptyState
        description={getMessage(messages, "admin.labels.empty_description")}
        hasPageLinks={hasPageLinks}
        itemLabel={getMessage(messages, "admin.labels.title")}
        title={getMessage(messages, "admin.labels.empty_title")}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            {getMessage(messages, "admin.labels.columns.name")}
          </TableHead>
          <TableHead className="w-56">
            {getMessage(messages, "admin.labels.columns.actions")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {labels.map((label) => (
          <TableRow key={label.publicId}>
            <TableCell className="font-medium">{label.name}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                <LinkButton
                  render={<Link href={`/labels/${label.publicId}`} />}
                  variant="outline"
                >
                  {getMessage(messages, "admin.labels.edit_action")}
                </LinkButton>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export const LabelManager = ({
  labels,
  listErrorMessage,
  nextHref,
  pageSize,
  previousHref,
  locale,
}: LabelManagerProps) => {
  const messages = sharedCatalog(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (labels.length > 0 || hasPageLinks);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>
            {getMessage(messages, "admin.labels.list_title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.labels.list_description")}
          </CardDescription>
        </div>
        <LinkButton render={<Link href="/labels/new" />} variant="outline">
          {getMessage(messages, "admin.labels.new_action")}
        </LinkButton>
      </CardHeader>
      <CardContent className="grid gap-4">
        <LabelListBody
          hasPageLinks={hasPageLinks}
          labels={labels}
          listErrorMessage={listErrorMessage}
          locale={locale}
        />

        {showPagination ? (
          <PaginationFooter
            ariaLabel={getMessage(messages, "admin.labels.pagination_aria")}
            description={getMessage(
              messages,
              "admin.labels.pagination_description",
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
