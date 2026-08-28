import { getMessage } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLogin } from "#lib/auth-session";
import { getLocale, loadHostMessages } from "#lib/locale";
import { countUnreadNotifications, listNotifications } from "#lib/notification";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { NotificationList } from "./_components/notification-list";
import {
  defaultNotificationsPageSize,
  notificationsListHref,
  parseNotificationsSearchParams,
} from "./_lib/search-params";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.notifications.title") };
};

type NotificationsPageProps = PageProps<"/[tenant_id]/[locale]/notifications">;

const NotificationListSkeleton = () => (
  <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <SkeletonLine className="mb-4 h-6 w-28" />
    <div className="h-24 w-full animate-pulse rounded-md bg-muted" />
  </section>
);

const NotificationListData = async ({
  searchParams,
}: Pick<NotificationsPageProps, "searchParams">) => {
  const [resolvedSearchParams, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const { token } = parseNotificationsSearchParams(resolvedSearchParams);
  const [listResult, unreadResult, timeZone] = await Promise.all([
    listNotifications(tenantId, {
      limit: defaultNotificationsPageSize,
      locale,
      token,
    }),
    countUnreadNotifications(tenantId, locale),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!listResult.ok && listResult.requiresSignIn) {
    redirectToLogin(locale, notificationsListHref(token));
  }

  return (
    <NotificationList
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      nextToken={listResult.nextToken}
      notifications={listResult.notifications}
      previousToken={listResult.previousToken}
      tenantId={tenantId}
      timeZone={timeZone}
      token={token}
      unreadCount={unreadResult.unreadCount}
    />
  );
};

const NotificationsPage = ({ searchParams }: NotificationsPageProps) => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <h1 className="text-xl font-semibold">
        <Suspense fallback={<SkeletonLine className="h-6 w-20" />}>
          <Message message="host.notifications.title" />
        </Suspense>
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="host.notifications.description" />
        </Suspense>
      </p>
    </section>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
          <Message message="host.notifications.list_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<NotificationListSkeleton />}>
        <NotificationListData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </div>
);

export default NotificationsPage;
