import { SkeletonLine } from "@publira/ui-components/skeleton";
import { getMessage } from "@publira/utils/i18n";
import type { MessageValues } from "@publira/utils/i18n";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { PlatformMessageKey } from "#components/message";
import {
  PlatformPage,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageEyebrow,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import { countUnreadNotifications, listNotifications } from "#lib/notification";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";

import { NotificationManager } from "./_components/notification-manager";
import {
  buildNotificationsPath,
  defaultNotificationsPageSize,
  parseNotificationsSearchParams,
} from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.notifications.title") };
};

type NotificationsPageProps = PageProps<"/notifications">;

const NotificationManagerSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
    <div className="grid gap-3">
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
    </div>
  </div>
);

const message = (
  key: PlatformMessageKey,
  fallbackClassName: string,
  values?: MessageValues
) => (
  <Suspense fallback={<SkeletonLine className={fallbackClassName} />}>
    <Message message={key} values={values} />
  </Suspense>
);

const NotificationManagerData = async ({
  searchParams,
}: Pick<NotificationsPageProps, "searchParams">) => {
  const { token } = parseNotificationsSearchParams(await searchParams);
  const [locale, listResult, unreadResult, timeZone] = await Promise.all([
    getPlatformLocale(),
    listNotifications({ token }),
    countUnreadNotifications(),
    getPlatformDisplayTimeZone(),
  ]);
  const messages = await loadPlatformMessages(locale);

  await redirectToLoginIfSessionRejected(listResult, unreadResult);

  return (
    <NotificationManager
      copy={{
        actionColumn: message(
          "platform.notifications.columns.action",
          "h-4 w-12"
        ),
        cardDescription: message(
          "platform.notifications.card_description",
          "h-4 w-80"
        ),
        cardTitle: message("platform.notifications.card_title", "h-6 w-32"),
        columnAt: message("platform.notifications.columns.at", "h-4 w-12"),
        columnContent: message(
          "platform.notifications.columns.content",
          "h-4 w-12"
        ),
        columnStatus: message(
          "platform.notifications.columns.status",
          "h-4 w-12"
        ),
        emptyDescription: getMessage(
          messages,
          "platform.notifications.empty_description"
        ),
        emptyPageDescription: getMessage(
          messages,
          "platform.notifications.empty_page_description"
        ),
        emptyPageTitle: getMessage(
          messages,
          "platform.notifications.empty_page_title"
        ),
        emptyTitle: getMessage(messages, "platform.notifications.empty_title"),
        listErrorTitle: getMessage(
          messages,
          "platform.notifications.list_failed"
        ),
        markAllRead: message(
          "platform.notifications.mark_all_read",
          "h-4 w-32"
        ),
        markRead: message("platform.notifications.mark_read", "h-4 w-20"),
        markReadAriaLabel: (title) =>
          getMessage(messages, "platform.notifications.mark_read_aria", {
            title,
          }),
        markReadPending: message("platform.notifications.pending", "h-4 w-16"),
        paginationAriaLabel: getMessage(
          messages,
          "platform.notifications.pagination_aria"
        ),
        perPage: message("platform.notifications.per_page", "h-4 w-64", {
          count: defaultNotificationsPageSize,
        }),
        read: message("platform.notifications.read", "h-4 w-12"),
        unread: message("platform.notifications.unread", "h-4 w-12"),
      }}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      nextHref={
        listResult.nextToken
          ? buildNotificationsPath({ token: listResult.nextToken })
          : undefined
      }
      nextLabel={
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.next" />
        </Suspense>
      }
      notifications={listResult.notifications}
      previousHref={
        listResult.previousToken
          ? buildNotificationsPath({ token: listResult.previousToken })
          : undefined
      }
      previousLabel={
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="platform.common.previous" />
        </Suspense>
      }
      timeZone={timeZone}
      unreadCount={unreadResult.unreadCount}
    />
  );
};

const NotificationsPage = ({ searchParams }: NotificationsPageProps) => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageEyebrow>
          <Suspense fallback={<SkeletonLine className="h-3 w-36" />}>
            <Message message="platform.shell.eyebrow" />
          </Suspense>
        </PlatformPageEyebrow>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-24" />}>
            <Message message="platform.notifications.heading" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.notifications.page_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="platform.notifications.list_failed" />
          </Suspense>
        }
      >
        <Suspense fallback={<NotificationManagerSkeleton />}>
          <NotificationManagerData searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </PlatformPageContent>
  </PlatformPage>
);

export default NotificationsPage;
