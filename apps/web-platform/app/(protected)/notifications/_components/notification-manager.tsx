import type { Locale } from "@publira/i18n";
import { StatusChip } from "@publira/ui-components/badge";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { PaginationControls } from "#components/pagination-controls";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";

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
  notifications,
  timeZone,
}: {
  hasPageLinks: boolean;
  listErrorMessage?: string;
  locale: Locale;
  markReadAriaLabel: (title: string) => string;
  notifications: NotificationItem[];
  timeZone: string;
}) => {
  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="platform.notifications.list_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  if (notifications.length === 0) {
    return hasPageLinks ? (
      <EmptyState.Root>
        <EmptyState.Heading>
          <EmptyState.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="platform.notifications.empty_page_title" />
            </Suspense>
          </EmptyState.Title>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="platform.notifications.empty_page_description" />
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Heading>
      </EmptyState.Root>
    ) : (
      <EmptyState.Root>
        <EmptyState.Heading>
          <EmptyState.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="platform.notifications.empty_title" />
            </Suspense>
          </EmptyState.Title>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="platform.notifications.empty_description" />
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Heading>
      </EmptyState.Root>
    );
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head className="w-24">
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="platform.notifications.columns.status" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-44">
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="platform.notifications.columns.at" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="platform.notifications.columns.content" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-36">
            <span className="sr-only">
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="platform.notifications.columns.action" />
              </Suspense>
            </span>
          </Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {notifications.map((item) => (
          <Table.Row key={item.id}>
            <Table.Cell>
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
            </Table.Cell>
            <Table.Cell>
              {formatNotificationDateTime(item.createdAt, locale, timeZone)}
            </Table.Cell>
            <Table.Cell>
              <div className="grid gap-1">
                <NotificationTitle item={item} />
                <p className="text-sm text-muted-foreground">
                  {item.description}
                </p>
              </div>
            </Table.Cell>
            <Table.Cell>
              {item.isRead ? null : (
                <MarkNotificationAsReadButton
                  aria-label={markReadAriaLabel(item.title)}
                  notificationId={item.id}
                >
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="platform.notifications.mark_read" />
                  </Suspense>
                </MarkNotificationAsReadButton>
              )}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
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
  const t = await getMessagesFor(locale);
  const hasPageLinks = Boolean(previousHref || nextHref);

  const showPagination =
    !listErrorMessage && (notifications.length > 0 || hasPageLinks);

  const hasUnread =
    unreadCount > 0 || notifications.some((item) => !item.isRead);

  return (
    <div className="grid gap-4">
      {hasUnread && !listErrorMessage ? (
        <div className="flex justify-end">
          <MarkAllNotificationsAsReadButton>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.notifications.mark_all_read" />
            </Suspense>
          </MarkAllNotificationsAsReadButton>
        </div>
      ) : null}

      {renderNotificationListBody({
        hasPageLinks,
        listErrorMessage,
        locale,
        markReadAriaLabel: (title) =>
          t("platform.notifications.mark_read_aria", {
            title,
          }),
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
            aria-label={t("platform.notifications.pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </div>
      ) : null}
    </div>
  );
};
