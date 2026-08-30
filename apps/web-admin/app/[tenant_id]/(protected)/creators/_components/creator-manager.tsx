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
import Image from "next/image";
import Link from "next/link";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";

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

const CreatorListBody = ({
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
  const messages = sharedCatalog(locale);
  // A failed fetch still hands an empty `creators` array; do not show the empty
  // list state alongside the error or operators will read it as "no creators".
  if (listErrorMessage) {
    return (
      <SectionError
        description={listErrorMessage}
        title={getMessage(messages, "admin.creators.list_error")}
      />
    );
  }

  if (creators.length === 0) {
    return (
      <CursorPageEmptyState
        description={getMessage(messages, "admin.creators.empty_description")}
        hasPageLinks={hasPageLinks}
        itemLabel={getMessage(messages, "admin.creators.title")}
        title={getMessage(messages, "admin.creators.empty_title")}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">
            {getMessage(messages, "admin.creators.columns.image")}
          </TableHead>
          <TableHead>
            {getMessage(messages, "admin.creators.columns.name")}
          </TableHead>
          <TableHead>
            {getMessage(messages, "admin.creators.columns.profile")}
          </TableHead>
          <TableHead className="w-56">
            {getMessage(messages, "admin.creators.columns.actions")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {creators.map((creator) => (
          <TableRow key={creator.publicId}>
            <TableCell>
              {creator.iconImageUrl ? (
                <Image
                  alt={getMessage(messages, "admin.creators.icon_alt", {
                    name: creator.name,
                  })}
                  className="size-10 rounded-full border object-cover"
                  height={40}
                  src={creator.iconImageUrl}
                  width={40}
                />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {getMessage(messages, "admin.creators.unset")}
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
                  {getMessage(messages, "admin.creators.edit_action")}
                </LinkButton>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export const CreatorManager = ({
  creators,
  listErrorMessage,
  nextHref,
  pageSize,
  previousHref,
  locale,
}: CreatorManagerProps) => {
  const messages = sharedCatalog(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (creators.length > 0 || hasPageLinks);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>
            {getMessage(messages, "admin.creators.list_title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.creators.list_description")}
          </CardDescription>
        </div>
        <LinkButton render={<Link href="/creators/new" />} variant="outline">
          {getMessage(messages, "admin.creators.new_action")}
        </LinkButton>
      </CardHeader>
      <CardContent className="grid gap-4">
        <CreatorListBody
          creators={creators}
          hasPageLinks={hasPageLinks}
          listErrorMessage={listErrorMessage}
          locale={locale}
        />

        {showPagination ? (
          <PaginationFooter
            ariaLabel={getMessage(messages, "admin.creators.pagination_aria")}
            description={getMessage(
              messages,
              "admin.creators.pagination_description",
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
