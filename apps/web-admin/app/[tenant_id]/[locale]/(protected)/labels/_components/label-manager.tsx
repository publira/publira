import type { Locale } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import Link from "next/link";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";

import type { LabelListItem } from "../label-types";

type LabelManagerProps = CursorPageHrefs & {
  /**
   * Whether the operator may edit the label, which decides whether a row offers
   * to edit it or only to view it.
   */
  canEdit: boolean;
  labels: LabelListItem[];
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
};

const LabelListBody = async ({
  canEdit,
  hasPageLinks,
  labels,
  listErrorMessage,
  locale,
}: {
  canEdit: boolean;
  hasPageLinks: boolean;
  labels: LabelListItem[];
  listErrorMessage?: string;
  locale: Locale;
}) => {
  // A failed fetch still hands an empty `labels` array; do not show the empty
  // list state alongside the error or operators will read it as "no labels".
  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.labels.list_error" />
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

  if (labels.length === 0) {
    return (
      <CursorPageEmptyState
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.labels.title")}
      >
        <EmptyState.Heading>
          <EmptyState.Title>{t("admin.labels.empty_title")}</EmptyState.Title>
          <EmptyState.Description>
            {t("admin.labels.empty_description")}
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
              <Message message="admin.labels.columns.name" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-56">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.labels.columns.actions" />
            </Suspense>
          </Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {labels.map((label) => (
          <Table.Row key={label.publicId}>
            <Table.Cell className="font-medium">{label.name}</Table.Cell>
            <Table.Cell>
              <div className="flex flex-wrap gap-2">
                <LinkButton
                  render={<Link href={`/labels/${label.publicId}`} />}
                  variant="outline"
                >
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    {canEdit ? (
                      <Message message="admin.labels.edit_action" />
                    ) : (
                      <Message message="admin.common.view_action" />
                    )}
                  </Suspense>
                </LinkButton>
              </div>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
};

export const LabelManager = async ({
  canEdit,
  labels,
  listErrorMessage,
  nextHref,
  pageSize,
  previousHref,
  locale,
}: LabelManagerProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });

  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (labels.length > 0 || hasPageLinks);

  return (
    <div className="grid gap-6">
      <LabelListBody
        canEdit={canEdit}
        hasPageLinks={hasPageLinks}
        labels={labels}
        listErrorMessage={listErrorMessage}
        locale={locale}
      />

      {showPagination ? (
        <PaginationFooter.Root>
          <PaginationFooter.Description>
            {t("admin.labels.pagination_description", {
              count: pageSize,
            })}
          </PaginationFooter.Description>
          <PaginationFooter.Controls
            aria-label={t("admin.labels.pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </PaginationFooter.Root>
      ) : null}
    </div>
  );
};
