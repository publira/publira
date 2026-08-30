import { getMessage } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { getNotificationSettings } from "#lib/auth";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { updateNotificationSettingsAction } from "./_lib/actions";

const NOTIFICATION_SETTINGS_RETURN_TO = "/settings/notifications";

const NotificationsSection = async () => {
  const [locale, tenantId] = await Promise.all([getLocale(), getTenantId()]);
  await requirePublicSession(locale, NOTIFICATION_SETTINGS_RETURN_TO, tenantId);
  const [notificationSettings, messages] = await Promise.all([
    withPublicSessionReauth(
      locale,
      NOTIFICATION_SETTINGS_RETURN_TO,
      () => getNotificationSettings(tenantId),
      tenantId
    ),
    loadHostMessages(locale),
  ]);
  const emailNotificationsEnabled =
    notificationSettings?.emailNotificationsEnabled ?? true;

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">
        {getMessage(messages, "host.settings.email_notifications_heading")}
      </h2>
      <form action={updateNotificationSettingsAction} className="space-y-4">
        <LocaleField />
        <input name="tenantId" type="hidden" value={tenantId} />

        <label className="flex items-start gap-3 rounded-md border border-border/70 p-3">
          <input
            defaultChecked={emailNotificationsEnabled}
            name="emailNotificationsEnabled"
            type="checkbox"
          />
          <span className="text-sm">
            {getMessage(messages, "host.settings.email_notifications_label")}
            <span className="block text-muted-foreground">
              {getMessage(messages, "host.settings.email_notifications_help")}
            </span>
          </span>
        </label>

        <div className="flex justify-end">
          <button
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            type="submit"
          >
            {getMessage(messages, "host.settings.save")}
          </button>
        </div>
      </form>
    </section>
  );
};

const NotificationsSectionFallback = () => (
  <section className="space-y-4 rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <SkeletonLine className="mb-4 h-6 w-40" />
    <div className="h-20 w-full animate-pulse rounded-md bg-muted" />
  </section>
);

const NotificationsSettingsPage = () => (
  <div className="space-y-6">
    <Suspense fallback={<NotificationsSectionFallback />}>
      <NotificationsSection />
    </Suspense>
  </div>
);

export default NotificationsSettingsPage;
