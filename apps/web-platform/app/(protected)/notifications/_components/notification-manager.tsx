import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { StatusChip } from "@publira/ui-components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { EmptyState } from "@publira/ui-components/empty-state";
import { SectionError } from "@publira/ui-components/section-error";
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

import { Message } from "#components/message";
import { PaginationControls } from "#components/pagination-controls";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import type { PlatformMessages } from "#lib/locale";

import { defaultNotificationsPageSize } from "../_lib/search-params";
import type { NotificationItem } from "../notification-types";
import {
  MarkAllNotificationsAsReadButton,
  MarkNotificationAsReadButton,
} from "./notification-read-actions";

interface NotificationManagerProps {
  listErrorMessage?: string;
  nextHref?: string;
  notifications: NotificationItem[];
  previousHref?: string;
  timeZone: string;
  unreadCount: number;
}

const formatNotificationDateTime = (
  value: string,
  locale: Locale,
  timeZone: string
): string => formatDateTime(value, { fallback: "—", locale, timeZone });

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

const renderNotificationListBody = ({
  hasPageLinks,
  listErrorMessage,
  locale,
  markReadAriaLabel,
  messages,
  notifications,
  timeZone,
}: {
  hasPageLinks: boolean;
  listErrorMessage?: string;
  locale: Locale;
  markReadAriaLabel: (title: string) => string;
  messages: PlatformMessages;
  notifications: NotificationItem[];
  timeZone: string;
}) => {
  if (listErrorMessage) {
    return (
      <SectionError
        description={listErrorMessage}
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="platform.notifications.list_error" />
          </Suspense>
        }
      />
    );
  }

  if (notifications.length === 0) {
    return hasPageLinks ? (
      <EmptyState
        description={getMessage(
          messages,
          "platform.notifications.empty_page_description"
        )}
        title={getMessage(messages, "platform.notifications.empty_page_title")}
      />
    ) : (
      <EmptyState
        description={getMessage(
          messages,
          "platform.notifications.empty_description"
        )}
        title={getMessage(messages, "platform.notifications.empty_title")}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="platform.notifications.columns.status" />
            </Suspense>
          </TableHead>
          <TableHead className="w-44">
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="platform.notifications.columns.at" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="platform.notifications.columns.content" />
            </Suspense>
          </TableHead>
          <TableHead className="w-36">
            <span className="sr-only">
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="platform.notifications.columns.action" />
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
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="platform.notifications.read" />
                  </Suspense>
                </StatusChip>
              ) : (
                <StatusChip status="info">
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="platform.notifications.unread" />
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
                  ariaLabel={markReadAriaLabel(item.title)}
                  notificationId={item.id}
                >
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="platform.notifications.mark_read" />
                  </Suspense>
                </MarkNotificationAsReadButton>
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
  nextHref,
  notifications,
  previousHref,
  timeZone,
  unreadCount,
}: NotificationManagerProps) => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);
  const hasPageLinks = Boolean(previousHref || nextHref);
  const showPagination =
    !listErrorMessage && (notifications.length > 0 || hasPageLinks);
  const hasUnread =
    unreadCount > 0 || notifications.some((item) => !item.isRead);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>
            <Suspense fallback={<SkeletonLine className="h-6 w-32" />}>
              <Message message="platform.notifications.card_title" />
            </Suspense>
          </CardTitle>
          <CardDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="platform.notifications.card_description" />
            </Suspense>
          </CardDescription>
        </div>
        {hasUnread && !listErrorMessage ? (
          <MarkAllNotificationsAsReadButton>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.notifications.mark_all_read" />
            </Suspense>
          </MarkAllNotificationsAsReadButton>
        ) : null}
      </CardHeader>

      <CardContent className="grid gap-4">
        {renderNotificationListBody({
          hasPageLinks,
          listErrorMessage,
          locale,
          markReadAriaLabel: (title) =>
            getMessage(messages, "platform.notifications.mark_read_aria", {
              title,
            }),
          messages,
          notifications,
          timeZone,
        })}

        {showPagination ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                <Message
                  message="platform.notifications.per_page"
                  values={{ count: defaultNotificationsPageSize }}
                />
              </Suspense>
            </p>
            <PaginationControls
              ariaLabel={getMessage(
                messages,
                "platform.notifications.pagination_aria"
              )}
              nextHref={nextHref}
              nextLabel={
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.common.next" />
                </Suspense>
              }
              previousHref={previousHref}
              previousLabel={
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.common.previous" />
                </Suspense>
              }
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
