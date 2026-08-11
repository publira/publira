import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { FormMessage } from "@publira/ui-components/form-message";
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

type NotificationManagerProps = CursorPageHrefs & {
  listErrorMessage?: string;
  notifications: NotificationItem[];
  pageSize: number;
};

const formatAudience = (item: NotificationItem): string => {
  if (item.audienceType === "all") {
    return "全体";
  }
  if (item.targetUserName) {
    return `指定 (${item.targetUserName})`;
  }
  return "指定";
};

const excerpt = (text: string, maxLength: number): string => {
  const normalized = text.replaceAll(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
};

// Absolute API timestamp → admin display zone. `formatDateTime` falls back to
// the raw value when it cannot be parsed, so only the empty case is special.
const formatNotificationDateTime = (value: string): string =>
  value ? formatDateTime(value) : "—";

const NotificationListBody = ({
  hasPageLinks,
  listErrorMessage,
  notifications,
}: {
  hasPageLinks: boolean;
  listErrorMessage?: string;
  notifications: NotificationItem[];
}) => {
  // A failed fetch still hands an empty `notifications` array; do not show the
  // empty list state alongside the error or operators will read it as "none".
  if (listErrorMessage) {
    return <FormMessage variant="destructive">{listErrorMessage}</FormMessage>;
  }

  if (notifications.length === 0) {
    return (
      <CursorPageEmptyState
        description="通知作成から対象ユーザーに通知を配信してください。"
        hasPageLinks={hasPageLinks}
        itemLabel="通知"
        title="通知がまだありません。"
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-44">作成日時</TableHead>
          <TableHead>タイトル</TableHead>
          <TableHead>本文</TableHead>
          <TableHead className="w-52">対象</TableHead>
          <TableHead className="w-60">リンク先</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {notifications.map((notification) => (
          <TableRow key={notification.id}>
            <TableCell>
              {formatNotificationDateTime(notification.createdAt)}
            </TableCell>
            <TableCell className="font-medium">{notification.title}</TableCell>
            <TableCell>{excerpt(notification.body, 72)}</TableCell>
            <TableCell>{formatAudience(notification)}</TableCell>
            <TableCell>{notification.linkUrl || "—"}</TableCell>
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
}: NotificationManagerProps) => {
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (notifications.length > 0 || hasPageLinks);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>通知一覧</CardTitle>
          <CardDescription>
            作成済みの通知と配信対象を確認できます。
          </CardDescription>
        </div>
        <LinkButton
          render={<Link href="/notifications/new" />}
          variant="outline"
        >
          通知を作成
        </LinkButton>
      </CardHeader>

      <CardContent className="grid gap-4">
        <NotificationListBody
          hasPageLinks={hasPageLinks}
          listErrorMessage={listErrorMessage}
          notifications={notifications}
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
