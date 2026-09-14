import type { Locale } from "@publira/i18n";
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
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";

import type { CreatorListItem } from "../creator-types";

type CreatorManagerProps = CursorPageHrefs & {
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
  creators,
  hasPageLinks,
  listErrorMessage,
  locale,
}: {
  creators: CreatorListItem[];
  hasPageLinks: boolean;
  listErrorMessage?: string;
  locale: Locale;
}) => {
  // A failed fetch still hands an empty `creators` array; do not show the empty
  // list state alongside the error or operators will read it as "no creators".
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.creators.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const t = await getMessagesFor(locale);

  if (creators.length === 0) {
    return (
      <CursorPageEmptyState
        description={t("admin.creators.empty_description")}
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.creators.title")}
        title={t("admin.creators.empty_title")}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.creators.columns.image" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.creators.columns.name" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.creators.columns.profile" />
            </Suspense>
          </TableHead>
          <TableHead className="w-56">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.creators.columns.actions" />
            </Suspense>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {creators.map((creator) => (
          <TableRow key={creator.publicId}>
            <TableCell>
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
            </TableCell>
            <TableCell className="font-medium">{creator.name}</TableCell>
            <TableCell>{excerpt(creator.profileText)}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-2">
                <LinkButton
                  render={<Link href={`/creators/${creator.publicId}`} />}
                  variant="outline"
                >
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.creators.edit_action" />
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

export const CreatorManager = async ({
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
        creators={creators}
        hasPageLinks={hasPageLinks}
        listErrorMessage={listErrorMessage}
        locale={locale}
      />

      {showPagination ? (
        <PaginationFooter
          ariaLabel={t("admin.creators.pagination_aria")}
          description={t("admin.creators.pagination_description", {
            count: pageSize,
          })}
          nextHref={nextHref}
          previousHref={previousHref}
        />
      ) : null}
    </div>
  );
};
