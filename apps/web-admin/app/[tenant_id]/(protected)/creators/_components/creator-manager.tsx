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

import { useAdminMessage } from "#components/client-message";
import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";

import type { CreatorListItem } from "../creator-types";

type CreatorManagerProps = CursorPageHrefs & {
  creators: CreatorListItem[];
  listErrorMessage?: string;
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
}: {
  creators: CreatorListItem[];
  hasPageLinks: boolean;
  listErrorMessage?: string;
}) => {
  const t = useAdminMessage();
  // A failed fetch still hands an empty `creators` array; do not show the empty
  // list state alongside the error or operators will read it as "no creators".
  if (listErrorMessage) {
    return (
      <SectionError
        description={listErrorMessage}
        title={t("admin.creators.list_error")}
      />
    );
  }

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
            {t("admin.creators.columns.image")}
          </TableHead>
          <TableHead>{t("admin.creators.columns.name")}</TableHead>
          <TableHead>{t("admin.creators.columns.profile")}</TableHead>
          <TableHead className="w-56">
            {t("admin.creators.columns.actions")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {creators.map((creator) => (
          <TableRow key={creator.publicId}>
            <TableCell>
              {creator.iconImageUrl ? (
                <Image
                  alt={t("admin.creators.icon_alt", { name: creator.name })}
                  className="size-10 rounded-full border object-cover"
                  height={40}
                  src={creator.iconImageUrl}
                  width={40}
                />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t("admin.creators.unset")}
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
                  {t("admin.creators.edit_action")}
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
}: CreatorManagerProps) => {
  const t = useAdminMessage();
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (creators.length > 0 || hasPageLinks);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>{t("admin.creators.list_title")}</CardTitle>
          <CardDescription>
            {t("admin.creators.list_description")}
          </CardDescription>
        </div>
        <LinkButton render={<Link href="/creators/new" />} variant="outline">
          {t("admin.creators.new_action")}
        </LinkButton>
      </CardHeader>
      <CardContent className="grid gap-4">
        <CreatorListBody
          creators={creators}
          hasPageLinks={hasPageLinks}
          listErrorMessage={listErrorMessage}
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
      </CardContent>
    </Card>
  );
};
