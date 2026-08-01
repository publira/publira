import { revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { PUBLIC_SESSION_COOKIE_NAME } from "#lib/auth-shared";
import {
  listMyNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "#lib/notifications";
import { getTenantId } from "#lib/tenant-id";

const markNotificationAsReadAction = async (
  formData: FormData
): Promise<void> => {
  "use server";

  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const notificationId = String(formData.get("notificationId") ?? "").trim();

  if (!tenantId || !notificationId) {
    return;
  }

  const cookieStore = await cookies();
  const sessionId =
    cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value?.trim() ?? "";

  await markNotificationAsRead(tenantId, notificationId, sessionId);
  revalidateTag(`member-notifications-${tenantId}`, "max");
};

const markAllNotificationsAsReadAction = async (
  formData: FormData
): Promise<void> => {
  "use server";

  const tenantId = String(formData.get("tenantId") ?? "").trim();
  if (!tenantId) {
    return;
  }

  const cookieStore = await cookies();
  const sessionId =
    cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value?.trim() ?? "";

  await markAllNotificationsAsRead(tenantId, sessionId);
  revalidateTag(`member-notifications-${tenantId}`, "max");
};

const markNotificationAsReadAndNavigateAction = async (
  formData: FormData
): Promise<void> => {
  "use server";

  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const notificationId = String(formData.get("notificationId") ?? "").trim();
  const linkUrl = String(formData.get("linkUrl") ?? "").trim();

  if (!tenantId || !linkUrl) {
    return;
  }

  const cookieStore = await cookies();
  const sessionId =
    cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value?.trim() ?? "";

  if (notificationId) {
    await markNotificationAsRead(tenantId, notificationId, sessionId);
    revalidateTag(`member-notifications-${tenantId}`, "max");
  }

  redirect(linkUrl);
};

const NotificationsSection = async () => {
  const tenantId = await getTenantId();
  await connection();
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value ?? "";

  const result = await listMyNotifications(tenantId, sessionId);
  if (!result.ok && result.message.includes("セッションが無効")) {
    redirect("/login?returnTo=%2Fnotifications");
  }

  const unreadCount = result.notifications.filter(
    (item) => !item.isRead
  ).length;

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">通知一覧</h2>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            未読 {unreadCount} 件
          </span>
          {unreadCount > 0 ? (
            <form action={markAllNotificationsAsReadAction}>
              <input name="tenantId" type="hidden" value={tenantId} />
              <button
                className="inline-flex rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                type="submit"
              >
                すべて既読にする
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {result.ok ? null : (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {result.message}
        </div>
      )}

      {result.notifications.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
          現在表示できる通知はありません。
        </div>
      ) : (
        <div className="grid gap-3">
          {result.notifications.map((notification) => {
            const linkAction = (() => {
              if (!notification.linkUrl) {
                return null;
              }

              if (notification.isRead) {
                return (
                  <Link
                    className="inline-flex rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                    href={notification.linkUrl}
                  >
                    遷移先を開く
                  </Link>
                );
              }

              return (
                <form action={markNotificationAsReadAndNavigateAction}>
                  <input name="tenantId" type="hidden" value={tenantId} />
                  <input
                    name="notificationId"
                    type="hidden"
                    value={notification.id}
                  />
                  <input
                    name="linkUrl"
                    type="hidden"
                    value={notification.linkUrl}
                  />
                  <button
                    className="inline-flex rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                    type="submit"
                  >
                    開いて既読にする
                  </button>
                </form>
              );
            })();

            return (
              <article
                className="rounded-xl border border-border/70 bg-background p-4"
                key={notification.id}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="font-medium">{notification.title}</h3>
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        notification.isRead
                          ? "rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
                          : "rounded-full bg-primary/15 px-2 py-1 text-xs font-medium text-primary"
                      }
                    >
                      {notification.isRead ? "既読" : "未読"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {notification.createdAt || "-"}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {notification.body}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {notification.isRead ? null : (
                    <form action={markNotificationAsReadAction}>
                      <input name="tenantId" type="hidden" value={tenantId} />
                      <input
                        name="notificationId"
                        type="hidden"
                        value={notification.id}
                      />
                      <button
                        className="inline-flex rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                        type="submit"
                      >
                        既読にする
                      </button>
                    </form>
                  )}
                  {linkAction}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

const NotificationsSectionFallback = () => (
  <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <h2 className="mb-4 text-lg font-semibold">通知一覧</h2>
    <div className="h-24 w-full animate-pulse rounded-md bg-muted" />
  </section>
);

export default function NotificationsPage() {
  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">通知</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          運営から配信された通知を確認できます。
        </p>
      </section>

      <Suspense fallback={<NotificationsSectionFallback />}>
        <NotificationsSection />
      </Suspense>
    </div>
  );
}
