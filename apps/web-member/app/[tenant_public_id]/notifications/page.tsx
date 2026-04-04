import Link from "next/link";
import { Suspense } from "react";

import { listMyNotifications } from "#lib/notifications";

const NotificationsSection = async ({
  tenantPublicId,
}: {
  tenantPublicId: string;
}) => {
  const result = await listMyNotifications(tenantPublicId);

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">通知一覧</h2>

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
          {result.notifications.map((notification) => (
            <article
              className="rounded-xl border border-border/70 bg-background p-4"
              key={notification.id}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="font-medium">{notification.title}</h3>
                <span className="text-xs text-muted-foreground">
                  {notification.createdAt || "-"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {notification.body}
              </p>
              {notification.linkUrl ? (
                <div className="mt-3">
                  <Link
                    className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                    href={notification.linkUrl}
                  >
                    遷移先を開く
                  </Link>
                </div>
              ) : null}
            </article>
          ))}
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

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ tenant_public_id: string }>;
}) {
  const { tenant_public_id } = await params;

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">通知</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          運営から配信された通知を確認できます。
        </p>
      </section>

      <Suspense fallback={<NotificationsSectionFallback />}>
        <NotificationsSection tenantPublicId={tenant_public_id} />
      </Suspense>
    </div>
  );
}
