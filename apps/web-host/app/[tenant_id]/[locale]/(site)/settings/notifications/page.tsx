import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import { getNotificationSettings } from "#lib/auth";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantWebPushPublicKey } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { BrowserNotificationsCard } from "./_components/browser-notifications-card";
import { updateNotificationSettingsAction } from "./_lib/actions";

const NOTIFICATION_SETTINGS_RETURN_TO = "/settings/notifications";

/**
 * The checkbox and its label are separate elements rather than a label wrapping
 * the input, because the label's text is a `<Message>` behind its own
 * `<Suspense>` — an element, not a string the markup carries. `htmlFor` is what
 * still ties the two together for a screen reader.
 */
const EMAIL_NOTIFICATIONS_FIELD_ID = "emailNotificationsEnabled";

const NotificationsSection = async () => {
  const [locale, tenantId] = await Promise.all([getLocale(), getTenantId()]);
  await requirePublicSession(locale, NOTIFICATION_SETTINGS_RETURN_TO, tenantId);
  const notificationSettings = await withPublicSessionReauth(
    locale,
    NOTIFICATION_SETTINGS_RETURN_TO,
    () => getNotificationSettings(tenantId),
    tenantId
  );
  const emailNotificationsEnabled =
    notificationSettings?.emailNotificationsEnabled ?? true;

  return (
    <section className="border border-border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">
        <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
          <Message message="host.settings.email_notifications_heading" />
        </Suspense>
      </h2>
      <form action={updateNotificationSettingsAction} className="space-y-4">
        <LocaleField />
        <input name="tenantId" type="hidden" value={tenantId} />

        <div className="flex items-start gap-3 rounded-md border border-border/70 p-3">
          <input
            defaultChecked={emailNotificationsEnabled}
            id={EMAIL_NOTIFICATIONS_FIELD_ID}
            name="emailNotificationsEnabled"
            type="checkbox"
          />
          <span className="text-sm">
            <label htmlFor={EMAIL_NOTIFICATIONS_FIELD_ID}>
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="host.settings.email_notifications_label" />
              </Suspense>
            </label>
            <span className="block text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                <Message message="host.settings.email_notifications_help" />
              </Suspense>
            </span>
          </span>
        </div>

        <div className="flex justify-end">
          <button
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            type="submit"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="host.settings.save" />
            </Suspense>
          </button>
        </div>
      </form>
    </section>
  );
};

/**
 * Browser pushes, offered only where they can actually be delivered: a
 * deployment with no VAPID key publishes none, and `RegisterPushDevice` refuses
 * a web registration without one, so the card is left out rather than shown as
 * a switch every subscription would fail behind.
 *
 * Its copy is resolved here and passed down as strings. Which line the card
 * shows is decided in the browser — after a permission prompt, after a push
 * service answered — where a `<Message>` cannot reach.
 */
const BrowserNotificationsSection = async () => {
  const [locale, tenantId] = await Promise.all([getLocale(), getTenantId()]);
  const [t, vapidPublicKey] = await Promise.all([
    getMessagesFor(locale),
    getTenantWebPushPublicKey(tenantId),
  ]);
  if (!vapidPublicKey) {
    return null;
  }

  return (
    <BrowserNotificationsCard
      copy={{
        denied: t("host.settings.browser_notifications_denied"),
        description: t("host.settings.browser_notifications_help"),
        heading: t("host.settings.browser_notifications_heading"),
        label: t("host.settings.browser_notifications_label"),
        turnOffFailed: t("host.settings.browser_notifications_off_failed"),
        turnOnFailed: t("host.settings.browser_notifications_failed"),
      }}
      locale={locale}
      tenantId={tenantId}
      vapidPublicKey={vapidPublicKey}
    />
  );
};

const NotificationsSectionFallback = () => (
  <section className="space-y-4 border border-border bg-card p-6">
    <SkeletonLine className="mb-4 h-6 w-40" />
    <div className="h-20 w-full animate-pulse rounded-md bg-muted" />
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
