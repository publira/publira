import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  getNotificationSettings,
  updateNotificationSettings,
} from "../../../../lib/auth";

const buildSettingsPath = (status: "success" | "error", message: string) => {
  const params = new URLSearchParams({ message, status });
  return `/settings/notifications?${params.toString()}`;
};

const updateNotificationSettingsAction = async (
  formData: FormData
): Promise<void> => {
  "use server";

  const tenantPublicId = String(formData.get("tenantPublicId") ?? "").trim();
  const enabled =
    String(formData.get("emailNotificationsEnabled") ?? "") === "on";

  const updated = await updateNotificationSettings(tenantPublicId, enabled);
  if (!updated) {
    redirect(
      buildSettingsPath(
        "error",
        "通知設定の更新に失敗しました。時間をおいて再度お試しください。"
      )
    );
  }

  redirect(buildSettingsPath("success", "通知設定を更新しました。"));
};

const NotificationsSection = async ({
  tenantPublicId,
}: {
  tenantPublicId: string;
}) => {
  const notificationSettings = await getNotificationSettings(tenantPublicId);
  const emailNotificationsEnabled =
    notificationSettings?.emailNotificationsEnabled ?? true;

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">メール通知設定</h2>
      <form action={updateNotificationSettingsAction} className="space-y-4">
        <input name="tenantPublicId" type="hidden" value={tenantPublicId} />

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

export default async function NotificationsSettingsPage({
  params,
}: {
  params: Promise<{ tenant_public_id: string }>;
}) {
  const { tenant_public_id } = await params;

  return (
    <div className="space-y-6">
      <Suspense fallback={<NotificationsSectionFallback />}>
        <NotificationsSection tenantPublicId={tenant_public_id} />
      </Suspense>
    </div>
  );
}
