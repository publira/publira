import type { Locale } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
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

import type { PageListItem } from "../page-types";
import { formatPageDateTime, formatPagePath } from "../page-types";

type PageManagerProps = CursorPageHrefs & {
  /**
   * Whether the operator may edit the page, which decides whether a row offers
   * to edit it or only to view it.
   */
  canEdit: boolean;
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
  pages: PageListItem[];
  timeZone: string;
};

const PageListBody = async ({
  canEdit,
  hasPageLinks,
  listErrorMessage,
  locale,
  pages,
  timeZone,
}: {
  canEdit: boolean;
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
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.pages.list_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const t = await getMessagesFor(locale);

  if (pages.length === 0) {
    return (
      <CursorPageEmptyState
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.pages.title")}
      >
        <EmptyState.Heading>
          <EmptyState.Title>{t("admin.pages.empty_title")}</EmptyState.Title>
          <EmptyState.Description>
            {t("admin.pages.empty_description")}
          </EmptyState.Description>
        </EmptyState.Heading>
      </CursorPageEmptyState>
    );
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.pages.columns.title" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.pages.columns.slug" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-32">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.pages.columns.status" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-28">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.pages.columns.footer" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-40">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.pages.columns.updated_at" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-32">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.pages.columns.actions" />
            </Suspense>
          </Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {pages.map((page) => (
          <Table.Row key={page.id}>
            <Table.Cell className="font-medium">{page.title}</Table.Cell>
            <Table.Cell>{formatPagePath(page.slug)}</Table.Cell>
            <Table.Cell>
              <Badge
                tone={page.publishedVersionId.length > 0 ? "info" : "muted"}
              >
                {page.publishedVersionId.length > 0
                  ? t("admin.pages.published")
                  : t("admin.pages.draft")}
              </Badge>
            </Table.Cell>
            <Table.Cell>
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
            </Table.Cell>
            <Table.Cell>
              {formatPageDateTime(page.updatedAt, locale, timeZone)}
            </Table.Cell>
            <Table.Cell>
              <LinkButton href={`/pages/${page.id}`} variant="outline">
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  {canEdit ? (
                    <Message message="admin.pages.edit_action" />
                  ) : (
                    <Message message="admin.common.view_action" />
                  )}
                </Suspense>
              </LinkButton>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
};

export const PageManager = async ({
  canEdit,
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
        canEdit={canEdit}
        hasPageLinks={hasPageLinks}
        listErrorMessage={listErrorMessage}
        locale={locale}
        pages={pages}
        timeZone={timeZone}
      />

      {showPagination ? (
        <PaginationFooter>
          <PaginationFooterDescription>
            {t("admin.pages.pagination_description", {
              count: pageSize,
            })}
          </PaginationFooterDescription>
          <PaginationControls
            aria-label={t("admin.pages.pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </PaginationFooter>
      ) : null}
    </div>
  );
};
