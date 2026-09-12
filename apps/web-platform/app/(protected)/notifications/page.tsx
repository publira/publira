import { getMessage } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { TableSkeleton } from "@publira/ui-components/table";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  PlatformPage,
  PlatformPageContent,
  PlatformPageDescription,
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
  parseNotificationsSearchParams,
} from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  return { title: getMessage(messages, "platform.notifications.title") };
};

type NotificationsPageProps = PageProps<"/notifications">;

const NotificationManagerData = async ({
  searchParams,
}: Pick<NotificationsPageProps, "searchParams">) => {
  const { token } = parseNotificationsSearchParams(await searchParams);
  const locale = await getPlatformLocale();
  const [listResult, unreadResult, timeZone] = await Promise.all([
    listNotifications(locale, { token }),
    countUnreadNotifications(locale),
    getPlatformDisplayTimeZone(),
  ]);
  await redirectToLoginIfSessionRejected(listResult, unreadResult);

  return (
    <NotificationManager
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      nextHref={
        listResult.nextToken
          ? buildNotificationsPath({ token: listResult.nextToken })
          : undefined
      }
      notifications={listResult.notifications}
      previousHref={
        listResult.previousToken
          ? buildNotificationsPath({ token: listResult.previousToken })
          : undefined
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
            <Message message="platform.notifications.list_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<TableSkeleton />}>
          <NotificationManagerData searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </PlatformPageContent>
  </PlatformPage>
);

export default NotificationsPage;
