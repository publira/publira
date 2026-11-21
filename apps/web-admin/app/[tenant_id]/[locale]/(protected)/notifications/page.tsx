import * as ConsolePage from "@publira/layouts/admin/console-page";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { countUnreadNotifications, listNotifications } from "#lib/notification";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { NotificationManager } from "./_components/notification-manager";

type NotificationsPageProps = PageProps<"/[tenant_id]/[locale]/notifications">;

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("admin.notifications.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const NotificationManagerData = async ({
  searchParams,
}: Pick<NotificationsPageProps, "searchParams">) => {
  const [sp, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);

  const { token } = parseCursorSearchParams(sp);

  const [listResult, unreadResult, timeZone] = await Promise.all([
    listNotifications(tenantId, locale, { token }),
    countUnreadNotifications(tenantId, locale),
    getTenantDisplayTimeZone(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(listResult);

  return (
    <NotificationManager
      {...cursorPageHrefs(listResult)}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      locale={locale}
      notifications={listResult.notifications}
      pageSize={DEFAULT_PAGE_SIZE}
      tenantId={tenantId}
      timeZone={timeZone}
      unreadCount={unreadResult.unreadCount}
    />
  );
};

const NotificationsPage = ({ searchParams }: NotificationsPageProps) => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
            <Message message="admin.notifications.title" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.notifications.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <Suspense fallback={<Table.Skeleton />}>
        <NotificationManagerData searchParams={searchParams} />
      </Suspense>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default NotificationsPage;
