import type { Locale } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";

import type { CreatorListItem } from "../creator-types";

type CreatorManagerProps = CursorPageHrefs & {
  /**
   * Whether the operator may edit the creator, which decides whether a row offers
   * to edit it or only to view it.
   */
  canEdit: boolean;
  creators: CreatorListItem[];
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
};

const excerpt = (text: string, max = 56) => {
  const normalized = text.replaceAll(/\s+/gu, " ").trim();
  if (normalized.length <= max) {
    return normalized || "-";
  }

  return `${normalized.slice(0, max)}...`;
};

const CreatorListBody = async ({
  canEdit,
  creators,
  hasPageLinks,
  listErrorMessage,
  locale,
}: {
  canEdit: boolean;
  creators: CreatorListItem[];
  hasPageLinks: boolean;
  listErrorMessage?: string;
  locale: Locale;
}) => {
  // A failed fetch still hands an empty `creators` array; do not show the empty
  // list state alongside the error or operators will read it as "no creators".
  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.creators.list_error" />
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

  if (creators.length === 0) {
    return (
      <CursorPageEmptyState
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.creators.title")}
      >
        <EmptyState.Heading>
          <EmptyState.Title>{t("admin.creators.empty_title")}</EmptyState.Title>
          <EmptyState.Description>
            {t("admin.creators.empty_description")}
          </EmptyState.Description>
        </EmptyState.Heading>
      </CursorPageEmptyState>
    );
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head className="w-24">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.creators.columns.image" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.creators.columns.name" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.creators.columns.profile" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-56">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.creators.columns.actions" />
            </Suspense>
          </Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {creators.map((creator) => (
          <Table.Row key={creator.publicId}>
            <Table.Cell>
              {creator.iconImageUrl ? (
                <Image
                  alt={t("admin.creators.icon_alt", {
                    name: creator.name,
                  })}
                  className="size-10 rounded-full border object-cover"
                  height={40}
                  src={creator.iconImageUrl}
                  width={40}
                />
              ) : (
                <span className="text-xs text-muted-foreground">
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.creators.unset" />
                  </Suspense>
                </span>
              )}
            </Table.Cell>
            <Table.Cell className="font-medium">{creator.name}</Table.Cell>
            <Table.Cell>{excerpt(creator.profileText)}</Table.Cell>
            <Table.Cell>
              <div className="flex flex-wrap gap-2">
                <LinkButton
                  render={<Link href={`/creators/${creator.publicId}`} />}
                  variant="outline"
                >
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    {canEdit ? (
                      <Message message="admin.creators.edit_action" />
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

export const CreatorManager = async ({
  canEdit,
  creators,
  listErrorMessage,
  nextHref,
  pageSize,
  previousHref,
  locale,
}: CreatorManagerProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (creators.length > 0 || hasPageLinks);

  return (
    <div className="grid gap-6">
      <CreatorListBody
        canEdit={canEdit}
        creators={creators}
        hasPageLinks={hasPageLinks}
        listErrorMessage={listErrorMessage}
        locale={locale}
      />

      {showPagination ? (
        <PaginationFooter.Root>
          <PaginationFooter.Description>
            {t("admin.creators.pagination_description", {
              count: pageSize,
            })}
          </PaginationFooter.Description>
          <PaginationFooter.Controls
            aria-label={t("admin.creators.pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </PaginationFooter.Root>
      ) : null}
    </div>
  );
};
