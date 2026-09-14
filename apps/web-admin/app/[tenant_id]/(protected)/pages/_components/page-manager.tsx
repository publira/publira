import type { Locale } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
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
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";

import type { PageListItem } from "../page-types";
import { formatPageDateTime, formatPagePath } from "../page-types";

type PageManagerProps = CursorPageHrefs & {
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
  pages: PageListItem[];
  timeZone: string;
};

const PageListBody = async ({
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
  // A failed fetch still hands an empty `pages` array; do not show the empty
  // list state alongside the error or operators will read it as "no pages".
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.pages.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const t = await getMessagesFor(locale);

  if (pages.length === 0) {
    return (
      <CursorPageEmptyState
        description={t("admin.pages.empty_description")}
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.pages.title")}
        title={t("admin.pages.empty_title")}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.pages.columns.title" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.pages.columns.slug" />
            </Suspense>
          </TableHead>
          <TableHead className="w-32">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.pages.columns.status" />
            </Suspense>
          </TableHead>
          <TableHead className="w-28">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.pages.columns.footer" />
            </Suspense>
          </TableHead>
          <TableHead className="w-40">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.pages.columns.updated_at" />
            </Suspense>
          </TableHead>
          <TableHead className="w-32">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.pages.columns.actions" />
            </Suspense>
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
                  ? t("admin.pages.published")
                  : t("admin.pages.draft")}
              </Badge>
            </TableCell>
            <TableCell>
              {page.displayInFooter ? (
                <Badge tone="info">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.pages.visible" />
                  </Suspense>
                </Badge>
              ) : (
                <Badge tone="muted">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.pages.hidden" />
                  </Suspense>
                </Badge>
              )}
            </TableCell>
            <TableCell>
              {formatPageDateTime(page.updatedAt, locale, timeZone)}
            </TableCell>
            <TableCell>
              <LinkButton href={`/pages/${page.id}`} variant="outline">
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.pages.edit_action" />
                </Suspense>
              </LinkButton>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export const PageManager = async ({
  listErrorMessage,
  nextHref,
  pageSize,
  pages,
  previousHref,
  timeZone,
  locale,
}: PageManagerProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (pages.length > 0 || hasPageLinks);

  return (
    <div className="grid gap-6">
      <PageListBody
        hasPageLinks={hasPageLinks}
        listErrorMessage={listErrorMessage}
        locale={locale}
        pages={pages}
        timeZone={timeZone}
      />

      {showPagination ? (
        <PaginationFooter
          ariaLabel={t("admin.pages.pagination_aria")}
          description={t("admin.pages.pagination_description", {
            count: pageSize,
          })}
          nextHref={nextHref}
          previousHref={previousHref}
        />
      ) : null}
    </div>
  );
};
