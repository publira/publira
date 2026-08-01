"use client";

import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { EmptyState } from "@publira/ui-components/empty-state";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import Link from "next/link";
import { useMemo } from "react";

import type { NotificationItem } from "../notification-types";

interface NotificationManagerProps {
  initialNotifications: NotificationItem[];
  initialListErrorMessage?: string;
}

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
  const normalized = text.replaceAll(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
};

export const NotificationManager = ({
  initialNotifications,
  initialListErrorMessage,
}: NotificationManagerProps) => {
  const notifications = useMemo(
    () =>
      initialNotifications.toSorted((a, b) =>
        b.createdAt.localeCompare(a.createdAt, "ja")
      ),
    [initialNotifications]
  );

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

      <CardContent>
        {initialListErrorMessage ? (
          <FormMessage className="mb-4" variant="destructive">
            {initialListErrorMessage}
          </FormMessage>
        ) : null}

        {notifications.length === 0 ? (
          <EmptyState
            description="通知作成から対象ユーザーに通知を配信してください。"
            title="通知がまだありません。"
          />
        ) : (
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
                  <TableCell>{notification.createdAt || "-"}</TableCell>
                  <TableCell className="font-medium">
                    {notification.title}
                  </TableCell>
                  <TableCell>{excerpt(notification.body, 72)}</TableCell>
                  <TableCell>{formatAudience(notification)}</TableCell>
                  <TableCell>{notification.linkUrl || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};
