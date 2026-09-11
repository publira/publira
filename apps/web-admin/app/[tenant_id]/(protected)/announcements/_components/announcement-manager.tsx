import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
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
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";

import type { AnnouncementItem } from "../announcement-types";

type AnnouncementManagerProps = CursorPageHrefs & {
  listErrorMessage?: string;
  announcements: AnnouncementItem[];
  locale: Locale;
  pageSize: number;
  timeZone: string;
};

const formatAudience = (
  item: AnnouncementItem,
  messages: SharedMessages
): string => {
  if (item.audienceType === "all") {
    return getMessage(messages, "admin.announcements.audience_all");
  }
  if (item.targetUserName) {
    return getMessage(messages, "admin.announcements.audience_selected_user", {
      name: item.targetUserName,
    });
  }
  return getMessage(messages, "admin.announcements.audience_selected");
};

const excerpt = (text: string, maxLength: number): string => {
  const normalized = text.replaceAll(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
};

// Absolute API timestamp → tenant display zone. `formatDateTime` falls back to
// the raw value when it cannot be parsed, so only the empty case is special.
const formatAnnouncementDateTime = (
  value: string,
  locale: Locale,
  timeZone: string
): string => (value ? formatDateTime(value, { locale, timeZone }) : "—");

const AnnouncementListBody = ({
  hasPageLinks,
  listErrorMessage,
  announcements,
  locale,
  timeZone,
}: {
  hasPageLinks: boolean;
  listErrorMessage?: string;
  announcements: AnnouncementItem[];
  locale: Locale;
  timeZone: string;
}) => {
  const messages = sharedCatalog(locale);
  // A failed fetch still hands an empty `announcements` array; do not show the
  // empty list state alongside the error or operators will read it as "none".
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.announcements.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (announcements.length === 0) {
    return (
      <CursorPageEmptyState
        description={getMessage(
          messages,
          "admin.announcements.empty_description"
        )}
        hasPageLinks={hasPageLinks}
        itemLabel={getMessage(messages, "admin.announcements.title")}
        title={getMessage(messages, "admin.announcements.empty_title")}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-44">
            {getMessage(messages, "admin.announcements.columns.created_at")}
          </TableHead>
          <TableHead>
            {getMessage(messages, "admin.announcements.columns.title")}
          </TableHead>
          <TableHead>
            {getMessage(messages, "admin.announcements.columns.body")}
          </TableHead>
          <TableHead className="w-52">
            {getMessage(messages, "admin.announcements.columns.audience")}
          </TableHead>
          <TableHead className="w-60">
            {getMessage(messages, "admin.announcements.columns.link")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {announcements.map((announcement) => (
          <TableRow key={announcement.id}>
            <TableCell>
              {formatAnnouncementDateTime(
                announcement.createdAt,
                locale,
                timeZone
              )}
            </TableCell>
            <TableCell className="font-medium">{announcement.title}</TableCell>
            <TableCell>{excerpt(announcement.body, 72)}</TableCell>
            <TableCell>{formatAudience(announcement, messages)}</TableCell>
            <TableCell>{announcement.linkUrl || "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export const AnnouncementManager = ({
  listErrorMessage,
  nextHref,
  announcements,
  locale,
  pageSize,
  previousHref,
  timeZone,
}: AnnouncementManagerProps) => {
  const messages = sharedCatalog(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (announcements.length > 0 || hasPageLinks);

  return (
    <div className="grid gap-6">
      <AnnouncementListBody
        hasPageLinks={hasPageLinks}
        listErrorMessage={listErrorMessage}
        announcements={announcements}
        locale={locale}
        timeZone={timeZone}
      />

      {showPagination ? (
        <PaginationFooter
          ariaLabel={getMessage(
            messages,
            "admin.announcements.pagination_aria"
          )}
          description={getMessage(
            messages,
            "admin.announcements.pagination_description",
            { count: pageSize }
          )}
          nextHref={nextHref}
          previousHref={previousHref}
        />
      ) : null}
    </div>
  );
};
