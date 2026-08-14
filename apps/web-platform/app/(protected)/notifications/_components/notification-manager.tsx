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

import { PaginationControls } from "#components/pagination-controls";

import type { NotificationItem } from "../notification-types";
import {
  MarkAllNotificationsAsReadButton,
  MarkNotificationAsReadButton,
} from "./notification-read-actions";

interface NotificationManagerProps {
  listErrorMessage?: string;
  nextHref?: string;
  notifications: NotificationItem[];
  pageSize: number;
  previousHref?: string;
  timeZone: string;
  unreadCount: number;
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
  hasPageLinks,
  listErrorMessage,
  notifications,
  timeZone,
}: {
  hasPageLinks: boolean;
  listErrorMessage?: string;
  notifications: NotificationItem[];
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
    return hasPageLinks ? (
      <EmptyState
        description="表示中に他の操作で削除された可能性があります。前後のページへ移動してください。"
        title="このページに表示できる通知はありません。"
      />
    ) : (
      <EmptyState
        description="予約公開の失敗など、運営者向けの業務イベントが起きると、ここに自分宛の通知が届きます。"
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
          <CardTitle>通知一覧</CardTitle>
          <CardDescription>
            自分宛の業務イベントです。テナント詳細へ遷移できます。
          </CardDescription>
        </div>
        {hasUnread && !listErrorMessage ? (
          <MarkAllNotificationsAsReadButton />
        ) : null}
      </CardHeader>

      <CardContent className="grid gap-4">
        <NotificationListBody
          hasPageLinks={hasPageLinks}
          listErrorMessage={listErrorMessage}
          notifications={notifications}
          timeZone={timeZone}
        />

        {showPagination ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {`新しい順に、1ページあたり ${pageSize} 件まで表示します。`}
            </p>
            <PaginationControls
              ariaLabel="通知一覧のページ送り"
              nextHref={nextHref}
              previousHref={previousHref}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
