import { Suspense } from "react";

import { getNotificationSettings } from "#lib/auth";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { getTenantId } from "#lib/tenant-id";

import { updateNotificationSettingsAction } from "./_lib/actions";

const NOTIFICATION_SETTINGS_RETURN_TO = "/settings/notifications";

const NotificationsSection = async () => {
  await requirePublicSession(NOTIFICATION_SETTINGS_RETURN_TO);
  const tenantId = await getTenantId();
  const notificationSettings = await withPublicSessionReauth(
    NOTIFICATION_SETTINGS_RETURN_TO,
    () => getNotificationSettings(tenantId)
  );
  const emailNotificationsEnabled =
    notificationSettings?.emailNotificationsEnabled ?? true;

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">メール通知設定</h2>
      <form action={updateNotificationSettingsAction} className="space-y-4">
        <input name="tenantId" type="hidden" value={tenantId} />

        <label className="flex items-start gap-3 rounded-md border border-border/70 p-3">
          <input
            defaultChecked={emailNotificationsEnabled}
            name="emailNotificationsEnabled"
            type="checkbox"
          />
          <span className="text-sm">
            メール通知を受け取る
            <span className="block text-muted-foreground">
              購読や重要なお知らせをメールで受信します。
            </span>
          </span>
        </label>

        <div className="flex justify-end">
          <button
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            type="submit"
          >
            保存
          </button>
        </div>
      </form>
    </section>
  );
};

const NotificationsSectionFallback = () => (
  <section className="space-y-4 rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <h2 className="mb-4 text-lg font-semibold">メール通知設定</h2>
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
