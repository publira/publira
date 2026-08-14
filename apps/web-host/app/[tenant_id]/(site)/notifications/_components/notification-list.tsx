import { SectionError } from "@publira/ui-components/section-error";
import { formatDateTime } from "@publira/utils";
import Link from "next/link";

import { notificationsListHref } from "../_lib/search-params";
import type { NotificationItem } from "../notification-types";
import {
  MarkAllNotificationsAsReadButton,
  MarkNotificationAsReadButton,
} from "./notification-read-actions";

interface NotificationListProps {
  listErrorMessage?: string;
  nextToken: string;
  notifications: NotificationItem[];
  previousToken: string;
  tenantId: string;
  timeZone: string;
  token: string;
  unreadCount: number;
}

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
        <p className="font-medium text-foreground">通知はまだありません。</p>
        <p className="mt-1">
          エピソードが公開されると、ここに自分宛の通知が届きます。
        </p>
      </div>
    );
  }

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

const NotificationTitle = ({ item }: { item: NotificationItem }) => {
  const title = item.href ? (
    <Link className="hover:underline" href={item.href}>
      {item.title}
    </Link>
  ) : (
    item.title
  );

  return <h3 className="font-medium">{title}</h3>;
};

export const NotificationList = ({
  listErrorMessage,
  nextToken,
  notifications,
  previousToken,
  tenantId,
  timeZone,
  token,
  unreadCount,
}: NotificationListProps) => {
  const hasUnread =
    unreadCount > 0 || notifications.some((item) => !item.isRead);

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">通知一覧</h2>
        {hasUnread && !listErrorMessage ? (
          <MarkAllNotificationsAsReadButton tenantId={tenantId} />
        ) : null}
      </div>

      {listErrorMessage ? (
        <SectionError
          description={listErrorMessage}
          title="通知一覧を表示できませんでした"
        />
      ) : null}

      {!listErrorMessage && notifications.length === 0 ? (
        <NotificationsEmptyState
          nextToken={nextToken}
          previousToken={previousToken}
          token={token}
        />
      ) : null}

      {notifications.length > 0 ? (
        <div className="grid gap-3">
          {notifications.map((item) => (
            <article
              className="rounded-xl border border-border/70 bg-background p-4"
              key={item.id}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <NotificationTitle item={item} />
                <div className="flex items-center gap-2">
                  <span
                    className={
                      item.isRead
                        ? "rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
                        : "rounded-full bg-info px-2 py-1 text-xs font-medium text-info-foreground"
                    }
                  >
                    {item.isRead ? "既読" : "未読"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(item.createdAt, {
                      fallback: "-",
                      timeZone,
                    })}
                  </span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {item.description}
              </p>
              {item.isRead ? null : (
                <div className="mt-3">
                  <MarkNotificationAsReadButton
                    label={item.title}
                    notificationId={item.id}
                    tenantId={tenantId}
                  />
                </div>
              )}
            </article>
          ))}
        </div>
      ) : null}

      {!listErrorMessage && notifications.length > 0 ? (
        <NotificationsPagination
          nextToken={nextToken}
          previousToken={previousToken}
        />
      ) : null}
    </section>
  );
};
