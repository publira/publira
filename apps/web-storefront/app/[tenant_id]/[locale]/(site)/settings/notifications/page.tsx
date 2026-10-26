import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import {
  getNotificationSettings,
  UNSAVED_NOTIFICATION_PREFERENCE_CELLS,
} from "#lib/auth";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getTenantWebPushPublicKey } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { BrowserNotificationsCard } from "./_components/browser-notifications-card";
import { NotificationPreferencesGrid } from "./_components/notification-preferences-grid";
import { updateNotificationSettingsAction } from "./_lib/actions";

const NOTIFICATION_SETTINGS_RETURN_TO = "/settings/notifications";

const NotificationsSection = async () => {
  const [locale, tenantId] = await Promise.all([getLocale(), getTenantId()]);
  await requirePublicSession(locale, NOTIFICATION_SETTINGS_RETURN_TO, tenantId);
  const preferences =
    (await withPublicSessionReauth(
      locale,
      NOTIFICATION_SETTINGS_RETURN_TO,
      () => getNotificationSettings(tenantId),
      tenantId
    )) ?? UNSAVED_NOTIFICATION_PREFERENCE_CELLS;

  return (
    <section className="border border-border bg-card p-6">
      <h2 className="mb-2 text-lg font-semibold">
        <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
          <Message message="storefront.settings.notification_preferences_heading" />
        </Suspense>
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <Message message="storefront.settings.notification_preferences_help" />
        </Suspense>
      </p>
      <form action={updateNotificationSettingsAction} className="space-y-6">
        <LocaleField />
        <input name="tenantId" type="hidden" value={tenantId} />

        <NotificationPreferencesGrid initialCells={preferences} />

        <div className="flex justify-end">
          <button
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            type="submit"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="storefront.settings.save" />
            </Suspense>
          </button>
        </div>
      </form>
    </section>
  );
};

/**
 * Whether this browser receives the pushes the grid's Web Push column chooses,
 * offered only where they can actually be delivered: a
 * platform that has not configured Web Push publishes no VAPID key, and
 * `RegisterPushDevice` refuses a web registration there, so the card is left
 * out rather than shown as a switch every subscription would fail behind.
 */
const BrowserNotificationsSection = async () => {
  const [locale, tenantId] = await Promise.all([getLocale(), getTenantId()]);
  const vapidPublicKey = await getTenantWebPushPublicKey(tenantId);
  if (!vapidPublicKey) {
    return null;
  }

  return (
    <BrowserNotificationsCard
      locale={locale}
      tenantId={tenantId}
      vapidPublicKey={vapidPublicKey}
    />
  );
};

const NotificationsSectionFallback = () => (
  <section className="space-y-4 border border-border bg-card p-6">
    <SkeletonLine className="mb-4 h-6 w-40" />
    <Skeleton className="h-20 w-full" />
  </section>
);

const NotificationsSettingsPage = () => (
  <div className="space-y-6">
    <Suspense fallback={<NotificationsSectionFallback />}>
      <NotificationsSection />
    </Suspense>
    <Suspense fallback={<NotificationsSectionFallback />}>
      <BrowserNotificationsSection />
    </Suspense>
  </div>
);

export default NotificationsSettingsPage;
