import type { Locale } from "@publira/i18n";
import {
  ActionForm,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
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
import {
  PaginationControls,
  PaginationFooter,
  PaginationFooterDescription,
} from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";

import { unpinAnnouncementAction } from "../_lib/actions";
import type { AnnouncementItem } from "../announcement-types";

type AnnouncementManagerProps = CursorPageHrefs & {
  listErrorMessage?: string;
  announcements: AnnouncementItem[];
  locale: Locale;
  pageSize: number;
  tenantId: string;
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

/**
 * Whether the site is showing this announcement as a banner, and until when.
 * Each branch names its key inside the `<Message>` it returns, the same way the
 * audience does.
 */
const BannerStateLabel = ({
  announcement,
  locale,
  timeZone,
}: {
  announcement: AnnouncementItem;
  locale: Locale;
  timeZone: string;
}) => {
  if (!announcement.pinnedUntil) {
    return <Message message="admin.announcements.banner_showing" />;
  }

  return (
    <Message
      message="admin.announcements.banner_showing_until"
      values={{
        until: formatAnnouncementDateTime(
          announcement.pinnedUntil,
          locale,
          timeZone
        ),
      }}
    />
  );
};

/**
 * The banner column of one row: what it says now, and the control that takes it
 * down. Only a pinned announcement has either — an ordinary one is a row in the
 * list and nothing else.
 */
const BannerCell = ({
  announcement,
  locale,
  tenantId,
  timeZone,
}: {
  announcement: AnnouncementItem;
  locale: Locale;
  tenantId: string;
  timeZone: string;
}) => {
  if (!announcement.pinned) {
    return "—";
  }

  return (
    <div className="grid gap-2">
      <span>
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <BannerStateLabel
            announcement={announcement}
            locale={locale}
            timeZone={timeZone}
          />
        </Suspense>
      </span>
      <ActionForm action={unpinAnnouncementAction} className="grid gap-2">
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="announcement_id" type="hidden" value={announcement.id} />
        <ActionFormSubmit className="justify-self-start" variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.announcements.unpin_action" />
          </Suspense>
        </ActionFormSubmit>
      </ActionForm>
    </div>
  );
};

const AnnouncementListBody = ({
  announcements,
  emptyDescription,
  emptyTitle,
  hasPageLinks,
  itemLabel,
  listErrorMessage,
  locale,
  tenantId,
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
  tenantId: string;
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
      <CursorPageEmptyState hasPageLinks={hasPageLinks} itemLabel={itemLabel}>
        <EmptyStateHeading>
          <EmptyStateTitle>{emptyTitle}</EmptyStateTitle>
          <EmptyStateDescription>{emptyDescription}</EmptyStateDescription>
        </EmptyStateHeading>
      </CursorPageEmptyState>
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
          <TableHead className="w-40">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.announcements.columns.banner" />
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
            <TableCell>
              <BannerCell
                announcement={announcement}
                locale={locale}
                tenantId={tenantId}
                timeZone={timeZone}
              />
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
  tenantId,
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
        tenantId={tenantId}
        timeZone={timeZone}
      />

      {showPagination ? (
        <PaginationFooter>
          <PaginationFooterDescription>
            {t("admin.announcements.pagination_description", {
              count: pageSize,
            })}
          </PaginationFooterDescription>
          <PaginationControls
            aria-label={t("admin.announcements.pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </PaginationFooter>
      ) : null}
    </div>
  );
};
