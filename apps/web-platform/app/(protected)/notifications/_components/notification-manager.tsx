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
import type { ReactNode } from "react";

import { PaginationControls } from "#components/pagination-controls";

import type { NotificationItem } from "../notification-types";
import {
  MarkAllNotificationsAsReadButton,
  MarkNotificationAsReadButton,
} from "./notification-read-actions";

interface NotificationManagerProps {
  copy: NotificationManagerCopy;
  listErrorMessage?: string;
  nextHref?: string;
  nextLabel: ReactNode;
  notifications: NotificationItem[];
  previousHref?: string;
  previousLabel: ReactNode;
  timeZone: string;
  unreadCount: number;
}

export interface NotificationManagerCopy {
  actionColumn: ReactNode;
  cardDescription: ReactNode;
  cardTitle: ReactNode;
  columnAt: ReactNode;
  columnContent: ReactNode;
  columnStatus: ReactNode;
  emptyDescription: string;
  emptyPageDescription: string;
  emptyPageTitle: string;
  emptyTitle: string;
  listErrorTitle: string;
  markAllRead: ReactNode;
  markRead: ReactNode;
  markReadPending: ReactNode;
  markReadAriaLabel: (title: string) => string;
  paginationAriaLabel: string;
  perPage: ReactNode;
  read: ReactNode;
  unread: ReactNode;
}

const formatNotificationDateTime = (value: string, timeZone: string): string =>
  formatDateTime(value, { fallback: "—", timeZone });

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
  copy,
  hasPageLinks,
  listErrorMessage,
  notifications,
  timeZone,
}: {
  copy: NotificationManagerCopy;
  hasPageLinks: boolean;
  listErrorMessage?: string;
  notifications: NotificationItem[];
  timeZone: string;
}) => {
  if (listErrorMessage) {
    return (
      <SectionError
        description={listErrorMessage}
        title={copy.listErrorTitle}
      />
    );
  }

  if (notifications.length === 0) {
    return hasPageLinks ? (
      <EmptyState
        description={copy.emptyPageDescription}
        title={copy.emptyPageTitle}
      />
    ) : (
      <EmptyState description={copy.emptyDescription} title={copy.emptyTitle} />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">{copy.columnStatus}</TableHead>
          <TableHead className="w-44">{copy.columnAt}</TableHead>
          <TableHead>{copy.columnContent}</TableHead>
          <TableHead className="w-36">
            <span className="sr-only">{copy.actionColumn}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {notifications.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              {item.isRead ? (
                <StatusChip status="muted">{copy.read}</StatusChip>
              ) : (
                <StatusChip status="info">{copy.unread}</StatusChip>
              )}
            </TableCell>
            <TableCell>
              {formatNotificationDateTime(item.createdAt, timeZone)}
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
                  ariaLabel={copy.markReadAriaLabel(item.title)}
                  idleLabel={copy.markRead}
                  notificationId={item.id}
                  pendingLabel={copy.markReadPending}
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
  copy,
  listErrorMessage,
  nextHref,
  nextLabel,
  notifications,
  previousHref,
  previousLabel,
  timeZone,
  unreadCount,
}: NotificationManagerProps) => {
  const hasPageLinks = Boolean(previousHref || nextHref);
  const showPagination =
    !listErrorMessage && (notifications.length > 0 || hasPageLinks);
  const hasUnread =
    unreadCount > 0 || notifications.some((item) => !item.isRead);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>{copy.cardTitle}</CardTitle>
          <CardDescription>{copy.cardDescription}</CardDescription>
        </div>
        {hasUnread && !listErrorMessage ? (
          <MarkAllNotificationsAsReadButton
            idleLabel={copy.markAllRead}
            pendingLabel={copy.markReadPending}
          />
        ) : null}
      </CardHeader>

      <CardContent className="grid gap-4">
        <NotificationListBody
          copy={copy}
          hasPageLinks={hasPageLinks}
          listErrorMessage={listErrorMessage}
          notifications={notifications}
          timeZone={timeZone}
        />

        {showPagination ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{copy.perPage}</p>
            <PaginationControls
              ariaLabel={copy.paginationAriaLabel}
              nextHref={nextHref}
              nextLabel={nextLabel}
              previousHref={previousHref}
              previousLabel={previousLabel}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
