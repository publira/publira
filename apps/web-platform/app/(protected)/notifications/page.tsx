import { getMessage } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
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

const NotificationManagerData = async ({
  searchParams,
}: Pick<NotificationsPageProps, "searchParams">) => {
  const { token } = parseNotificationsSearchParams(await searchParams);
  const [listResult, unreadResult, timeZone] = await Promise.all([
    listNotifications({ token }),
    countUnreadNotifications(),
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
