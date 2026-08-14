import { StatusChip } from "@publira/ui-components/badge";
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
  notifications: NotificationItem[];
  pageSize: number;
  tenantId: string;
  timeZone: string;
  unreadCount: number;
};

const formatNotificationDateTime = (value: string, timeZone: string): string =>
  value ? formatDateTime(value, { timeZone }) : "—";

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
  notifications,
  tenantId,
  timeZone,
}: {
  hasPageLinks: boolean;
  listErrorMessage?: string;
  notifications: NotificationItem[];
  tenantId: string;
  timeZone: string;
}) => {
  if (listErrorMessage) {
    return (
      <SectionError
        description={listErrorMessage}
        title="通知一覧を表示できませんでした"
      />
    );
  }

  if (notifications.length === 0) {
    return (
      <CursorPageEmptyState
        description="予約公開などの業務イベントが起きると、ここに自分宛の通知が届きます。"
        hasPageLinks={hasPageLinks}
        itemLabel="通知"
        title="通知はまだありません。"
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">状態</TableHead>
          <TableHead className="w-44">日時</TableHead>
          <TableHead>内容</TableHead>
          <TableHead className="w-36">
            <span className="sr-only">操作</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {notifications.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              {item.isRead ? (
                <StatusChip status="muted">既読</StatusChip>
              ) : (
                <StatusChip status="info">未読</StatusChip>
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
  nextHref,
  notifications,
  pageSize,
  previousHref,
  tenantId,
  timeZone,
  unreadCount,
}: NotificationManagerProps) => {
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (notifications.length > 0 || hasPageLinks);
  const hasUnread =
    unreadCount > 0 || notifications.some((item) => !item.isRead);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>通知一覧</CardTitle>
          <CardDescription>
            自分宛の業務イベントです。お知らせの配信管理とは別の一覧です。
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
          notifications={notifications}
          tenantId={tenantId}
          timeZone={timeZone}
        />

        {showPagination ? (
          <PaginationFooter
            ariaLabel="通知一覧のページ送り"
            description={`新しい順に、1ページあたり ${pageSize} 件まで表示します。`}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        ) : null}
      </CardContent>
    </Card>
  );
};
