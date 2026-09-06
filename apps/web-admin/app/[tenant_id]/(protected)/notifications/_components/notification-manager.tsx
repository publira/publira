import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { StatusChip } from "@publira/ui-components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
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

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";

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
  hasPageLinks,
  listErrorMessage,
  locale,
  notifications,
  tenantId,
  timeZone,
}: {
  hasPageLinks: boolean;
  listErrorMessage?: string;
  locale: Locale;
  notifications: NotificationItem[];
  tenantId: string;
  timeZone: string;
}) => {
  const messages = sharedCatalog(locale);
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            {getMessage(messages, "admin.notifications.list_error")}
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (notifications.length === 0) {
    return (
      <CursorPageEmptyState
        description={getMessage(
          messages,
          "admin.notifications.empty_description"
        )}
        hasPageLinks={hasPageLinks}
        itemLabel={getMessage(messages, "admin.notifications.title")}
        title={getMessage(messages, "admin.notifications.empty_title")}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">
            {getMessage(messages, "admin.notifications.columns.status")}
          </TableHead>
          <TableHead className="w-44">
            {getMessage(messages, "admin.notifications.columns.created_at")}
          </TableHead>
          <TableHead>
            {getMessage(messages, "admin.notifications.columns.content")}
          </TableHead>
          <TableHead className="w-36">
            <span className="sr-only">
              {getMessage(messages, "admin.notifications.columns.actions")}
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
                  {getMessage(messages, "admin.notifications.read")}
                </StatusChip>
              ) : (
                <StatusChip status="info">
                  {getMessage(messages, "admin.notifications.unread")}
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

export const NotificationManager = ({
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
  const messages = sharedCatalog(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (notifications.length > 0 || hasPageLinks);
  const hasUnread =
    unreadCount > 0 || notifications.some((item) => !item.isRead);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>
            {getMessage(messages, "admin.notifications.list_title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.notifications.list_description")}
          </CardDescription>
        </div>
        {hasUnread && !listErrorMessage ? (
          <MarkAllNotificationsAsReadButton tenantId={tenantId} />
        ) : null}
      </CardHeader>

      <CardContent className="grid gap-4">
        <NotificationListBody
          hasPageLinks={hasPageLinks}
          listErrorMessage={listErrorMessage}
          locale={locale}
          notifications={notifications}
          tenantId={tenantId}
          timeZone={timeZone}
        />

        {showPagination ? (
          <PaginationFooter
            ariaLabel={getMessage(
              messages,
              "admin.notifications.pagination_aria"
            )}
            description={getMessage(
              messages,
              "admin.notifications.pagination_description",
              { count: pageSize }
            )}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        ) : null}
      </CardContent>
    </Card>
  );
};
