import type { Locale } from "@publira/i18n";
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
import { getMessagesFor } from "#lib/messages";

import type { AnnouncementItem } from "../announcement-types";

type AnnouncementManagerProps = CursorPageHrefs & {
  listErrorMessage?: string;
  announcements: AnnouncementItem[];
  locale: Locale;
  pageSize: number;
  timeZone: string;
};

/**
 * Who the announcement went to, worded one branch at a time. Each branch names
 * its key inside the `<Message>` it returns, so the key stays where anything
 * reading this file for the strings the screen uses can see it.
 */
const AudienceLabel = ({ item }: { item: AnnouncementItem }) => {
  if (item.audienceType === "all") {
    return <Message message="admin.announcements.audience_all" />;
  }
  if (item.targetUserName) {
    return (
      <Message
        message="admin.announcements.audience_selected_user"
        values={{ name: item.targetUserName }}
      />
    );
  }

  return <Message message="admin.announcements.audience_selected" />;
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
  announcements,
  emptyDescription,
  emptyTitle,
  hasPageLinks,
  itemLabel,
  listErrorMessage,
  locale,
  timeZone,
}: {
  /** The empty state's copy, resolved by the async parent. */
  announcements: AnnouncementItem[];
  emptyDescription: string;
  emptyTitle: string;
  hasPageLinks: boolean;
  itemLabel: string;
  listErrorMessage?: string;
  locale: Locale;
  timeZone: string;
}) => {
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
        description={emptyDescription}
        hasPageLinks={hasPageLinks}
        itemLabel={itemLabel}
        title={emptyTitle}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-44">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.announcements.columns.created_at" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.announcements.columns.title" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.announcements.columns.body" />
            </Suspense>
          </TableHead>
          <TableHead className="w-52">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.announcements.columns.audience" />
            </Suspense>
          </TableHead>
          <TableHead className="w-60">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.announcements.columns.link" />
            </Suspense>
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
            <TableCell>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <AudienceLabel item={announcement} />
              </Suspense>
            </TableCell>
            <TableCell>{announcement.linkUrl || "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

/**
 * One announcement's audience, as its own async component: the label is a
 * string the catalog resolves, and a row rendered inside `.map()` cannot await.
 */
export const AnnouncementManager = async ({
  listErrorMessage,
  nextHref,
  announcements,
  locale,
  pageSize,
  previousHref,
  timeZone,
}: AnnouncementManagerProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (announcements.length > 0 || hasPageLinks);

  return (
    <div className="grid gap-6">
      <AnnouncementListBody
        announcements={announcements}
        emptyDescription={t("admin.announcements.empty_description")}
        emptyTitle={t("admin.announcements.empty_title")}
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.announcements.title")}
        listErrorMessage={listErrorMessage}
        locale={locale}
        timeZone={timeZone}
      />

      {showPagination ? (
        <PaginationFooter
          ariaLabel={t("admin.announcements.pagination_aria")}
          description={t("admin.announcements.pagination_description", {
            count: pageSize,
          })}
          nextHref={nextHref}
          previousHref={previousHref}
        />
      ) : null}
    </div>
  );
};
