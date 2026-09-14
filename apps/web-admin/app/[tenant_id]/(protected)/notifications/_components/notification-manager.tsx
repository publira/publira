import type { Locale } from "@publira/i18n";
import { StatusChip } from "@publira/ui-components/badge";
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
import Link from "next/link";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";

import type { NotificationItem } from "../notification-types";
import {
  MarkAllNotificationsAsReadButton,
  MarkNotificationAsReadButton,
} from "./notification-read-actions";

type NotificationManagerProps = CursorPageHrefs & {
  listErrorMessage?: string;
  locale: Locale;
  notifications: NotificationItem[];
  pageSize: number;
  tenantId: string;
  timeZone: string;
  unreadCount: number;
};

const formatNotificationDateTime = (
  value: string,
  locale: Locale,
  timeZone: string
): string => (value ? formatDateTime(value, { locale, timeZone }) : "—");

const NotificationTitle = ({ item }: { item: NotificationItem }) => {
  if (item.href) {
    return (
      <Link
        className="font-medium text-foreground hover:underline"
        href={item.href}
      >
        {item.title}
      </Link>
    );
  }

  return <span className="font-medium">{item.title}</span>;
};

const NotificationListBody = ({
  emptyDescription,
  emptyTitle,
  hasPageLinks,
  itemLabel,
  listErrorMessage,
  locale,
  notifications,
  tenantId,
  timeZone,
}: {
  /** The empty state's copy, resolved by the async parent. */
  emptyDescription: string;
  emptyTitle: string;
  hasPageLinks: boolean;
  itemLabel: string;
  listErrorMessage?: string;
  locale: Locale;
  notifications: NotificationItem[];
  tenantId: string;
  timeZone: string;
}) => {
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.notifications.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (notifications.length === 0) {
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
          <TableHead className="w-24">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.notifications.columns.status" />
            </Suspense>
          </TableHead>
          <TableHead className="w-44">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.notifications.columns.created_at" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.notifications.columns.content" />
            </Suspense>
          </TableHead>
          <TableHead className="w-36">
            <span className="sr-only">
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.notifications.columns.actions" />
              </Suspense>
            </span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {notifications.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              {item.isRead ? (
                <StatusChip status="muted">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.notifications.read" />
                  </Suspense>
                </StatusChip>
              ) : (
                <StatusChip status="info">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.notifications.unread" />
                  </Suspense>
                </StatusChip>
              )}
            </TableCell>
            <TableCell>
              {formatNotificationDateTime(item.createdAt, locale, timeZone)}
            </TableCell>
            <TableCell>
              <div className="grid gap-1">
                <NotificationTitle item={item} />
                <p className="text-sm text-muted-foreground">
                  {item.description}
                </p>
              </div>
            </TableCell>
            <TableCell>
              {item.isRead ? null : (
                <MarkNotificationAsReadButton
                  label={item.title}
                  notificationId={item.id}
                  tenantId={tenantId}
                />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export const NotificationManager = async ({
  listErrorMessage,
  locale,
  nextHref,
  notifications,
  pageSize,
  previousHref,
  tenantId,
  timeZone,
  unreadCount,
}: NotificationManagerProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (notifications.length > 0 || hasPageLinks);
  const hasUnread =
    unreadCount > 0 || notifications.some((item) => !item.isRead);

  return (
    <div className="grid gap-4">
      {hasUnread && !listErrorMessage ? (
        <div className="flex justify-end">
          <MarkAllNotificationsAsReadButton tenantId={tenantId} />
        </div>
      ) : null}

      <NotificationListBody
        emptyDescription={t("admin.notifications.empty_description")}
        emptyTitle={t("admin.notifications.empty_title")}
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.notifications.title")}
        listErrorMessage={listErrorMessage}
        locale={locale}
        notifications={notifications}
        tenantId={tenantId}
        timeZone={timeZone}
      />

      {showPagination ? (
        <PaginationFooter
          ariaLabel={t("admin.notifications.pagination_aria")}
          description={t("admin.notifications.pagination_description", {
            count: pageSize,
          })}
          nextHref={nextHref}
          previousHref={previousHref}
        />
      ) : null}
    </div>
  );
};
