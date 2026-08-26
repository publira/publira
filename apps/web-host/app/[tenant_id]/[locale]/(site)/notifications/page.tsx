import type { Metadata } from "next";
import { Suspense } from "react";

import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLogin } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { countUnreadNotifications, listNotifications } from "#lib/notification";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { NotificationList } from "./_components/notification-list";
import {
  defaultNotificationsPageSize,
  notificationsListHref,
  parseNotificationsSearchParams,
} from "./_lib/search-params";

export const metadata: Metadata = {
  title: "通知",
};

type NotificationsPageProps = PageProps<"/[tenant_id]/[locale]/notifications">;

const NotificationListSkeleton = () => (
  <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <h2 className="mb-4 text-lg font-semibold">通知一覧</h2>
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
      token,
    }),
    countUnreadNotifications(tenantId),
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
      <h1 className="text-xl font-semibold">通知</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        自分宛の通知を確認し、既読にできます。運営からのお知らせは別の一覧です。
      </p>
    </section>

    <SectionErrorBoundary title="通知一覧を表示できませんでした">
      <Suspense fallback={<NotificationListSkeleton />}>
        <NotificationListData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </div>
);

export default NotificationsPage;
