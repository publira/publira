import { SectionError } from "@publira/ui-components/section-error";
import { revalidateTag } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  listMyNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "#lib/notifications";
import { getTenantId } from "#lib/tenant-id";

import {
  notificationsListHref,
  parseNotificationsListSearchParams,
} from "./_lib/search-params";

const NOTIFICATIONS_PAGE_SIZE = 20;

/*
 * The session id is left to `resolveAccessToken()` inside `#lib/notifications`.
 * The `publira_web_host_auth` cookie holds an *encrypted* session payload, not
 * a bearer token, so reading it here and passing the raw value on made every
 * call fail `unauthenticated`; only the library's own cookie path decrypts it.
 */

const markNotificationAsReadAction = async (
  formData: FormData
): Promise<void> => {
  "use server";

  const tenantId = String(formData.get("tenantId") ?? "").trim();
  const notificationId = String(formData.get("notificationId") ?? "").trim();

  if (!tenantId || !notificationId) {
    return;
  }

  await markNotificationAsRead(tenantId, notificationId);
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

  await markAllNotificationsAsRead(tenantId);
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

  if (notificationId) {
    await markNotificationAsRead(tenantId, notificationId);
    revalidateTag(`member-notifications-${tenantId}`, "max");
  }

  redirect(linkUrl);
};

const NotificationsPagination = ({
  nextToken,
  previousToken,
}: {
  nextToken: string;
  previousToken: string;
}) => (
  <nav
    aria-label="通知一覧ページング"
    className="mt-6 flex items-center justify-center gap-6"
  >
    {previousToken ? (
      <Link
        className="text-sm text-primary underline-offset-4 hover:underline"
        href={notificationsListHref(previousToken)}
      >
        前のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">前のページ</span>
    )}

    {nextToken ? (
      <Link
        className="text-sm text-primary underline-offset-4 hover:underline"
        href={notificationsListHref(nextToken)}
      >
        次のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">次のページ</span>
    )}
  </nav>
);

const NotificationsEmptyState = ({
  nextToken,
  previousToken,
  token,
}: {
  nextToken: string;
  previousToken: string;
  token: string;
}) => {
  if (!token) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
        現在表示できる通知はありません。
      </div>
    );
  }

  // The rows this page pointed at are gone. The server hands back a token for
  // the neighbouring page when it can, and empty tokens when it cannot — then
  // the only way out is the first page (`proto/README.md`).
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-center text-sm text-muted-foreground">
      <p>このページに表示できる通知がありません。</p>
      {previousToken || nextToken ? (
        <NotificationsPagination
          nextToken={nextToken}
          previousToken={previousToken}
        />
      ) : (
        <Link
          className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
          href={notificationsListHref("")}
        >
          通知一覧の先頭へ
        </Link>
      )}
    </div>
  );
};

const NotificationsSection = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/notifications">["searchParams"];
}) => {
  const [resolvedSearchParams, tenantId] = await Promise.all([
    searchParams,
    getTenantId(),
  ]);
  const { token } = parseNotificationsListSearchParams(resolvedSearchParams);
  await connection();

  const result = await listMyNotifications(tenantId, undefined, {
    limit: NOTIFICATIONS_PAGE_SIZE,
    token,
  });
  if (!result.ok && result.requiresSignIn) {
    // Come back to the page the reader was actually on, not just the first one.
    redirect(
      `/login?returnTo=${encodeURIComponent(notificationsListHref(token))}`
    );
  }

  const { nextToken, previousToken } = result;
  // Only this page's rows are loaded, so this is a per-page count. A total
  // would need its own RPC, which the cursor contract deliberately leaves out
  // (`proto/README.md`).
  const unreadCount = result.notifications.filter(
    (item) => !item.isRead
  ).length;

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">通知一覧</h2>
        <div className="flex items-center gap-2">
          <span
            className={
              unreadCount > 0
                ? "rounded-full bg-info px-3 py-1 text-xs font-medium text-info-foreground"
                : "rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
            }
          >
            このページの未読 {unreadCount} 件
          </span>
          {result.notifications.length > 0 ? (
            // Offered on every non-empty page: the unread count above covers
            // this page only, so a page with nothing unread can still sit in
            // front of unread notifications further down the list.
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
        <SectionError
          className="mb-4"
          description={result.message}
          title="通知一覧を表示できませんでした"
        />
      )}

      {/*
        A failed read hands back an empty `notifications`, so the empty state
        stays behind `result.ok` — otherwise the page says the list could not
        be read and that there is nothing to read, one after the other.
      */}
      {result.ok && result.notifications.length === 0 ? (
        <NotificationsEmptyState
          nextToken={nextToken}
          previousToken={previousToken}
          token={token}
        />
      ) : null}

      {result.notifications.length > 0 ? (
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
                          : "rounded-full bg-info px-2 py-1 text-xs font-medium text-info-foreground"
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
      ) : null}

      {result.notifications.length > 0 ? (
        <NotificationsPagination
          nextToken={nextToken}
          previousToken={previousToken}
        />
      ) : null}
    </section>
  );
};

const NotificationsSectionFallback = () => (
  <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <h2 className="mb-4 text-lg font-semibold">通知一覧</h2>
    <div className="h-24 w-full animate-pulse rounded-md bg-muted" />
  </section>
);

const NotificationsPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/notifications">) => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <h1 className="text-xl font-semibold">通知</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        運営から配信された通知を確認できます。
      </p>
    </section>

    <SectionErrorBoundary title="通知一覧を表示できませんでした">
      <Suspense fallback={<NotificationsSectionFallback />}>
        <NotificationsSection searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </div>
);

export default NotificationsPage;
