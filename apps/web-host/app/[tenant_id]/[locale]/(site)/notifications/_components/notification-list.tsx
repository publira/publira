import { getMessage } from "@publira/i18n";
import { SectionError } from "@publira/ui-components/section-error";
import { formatDateTime } from "@publira/utils";

import { LocaleLink } from "#components/locale-link";
import { getLocale, loadHostMessages } from "#lib/locale";

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

const NotificationTitle = ({ item }: { item: NotificationItem }) => {
  const title = item.href ? (
    <LocaleLink className="hover:underline" href={item.href}>
      {item.title}
    </LocaleLink>
  ) : (
    item.title
  );

  return <h3 className="font-medium">{title}</h3>;
};

/**
 * The whole list resolves the catalog once, and the pieces that repeat — the
 * pager above all — are JSX values in this scope rather than components taking
 * a `messages` prop. The page renders this inside the section's own boundary,
 * so nothing here reaches the static shell.
 */
export const NotificationList = async ({
  listErrorMessage,
  nextToken,
  notifications,
  previousToken,
  tenantId,
  timeZone,
  token,
  unreadCount,
}: NotificationListProps) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);
  const hasUnread =
    unreadCount > 0 || notifications.some((item) => !item.isRead);
  const previousLabel = getMessage(messages, "host.common.previous_page");
  const nextLabel = getMessage(messages, "host.common.next_page");

  const pagination = (
    <nav
      aria-label={getMessage(messages, "host.notifications.pagination_aria")}
      className="mt-6 flex items-center justify-center gap-6"
    >
      {previousToken ? (
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={notificationsListHref(previousToken)}
        >
          {previousLabel}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">{previousLabel}</span>
      )}

      {nextToken ? (
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={notificationsListHref(nextToken)}
        >
          {nextLabel}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">{nextLabel}</span>
      )}
    </nav>
  );

  // The rows this page pointed at are gone. The server hands back a token for
  // the neighbouring page when it can, and empty tokens when it cannot — then
  // the only way out is the first page (`proto/README.md`).
  const emptyState = token ? (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-center text-sm text-muted-foreground">
      <p>{getMessage(messages, "host.notifications.page_empty")}</p>
      {previousToken || nextToken ? (
        pagination
      ) : (
        <LocaleLink
          className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
          href={notificationsListHref("")}
        >
          {getMessage(messages, "host.notifications.first_page")}
        </LocaleLink>
      )}
    </div>
  ) : (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">
        {getMessage(messages, "host.notifications.empty_title")}
      </p>
      <p className="mt-1">
        {getMessage(messages, "host.notifications.empty_description")}
      </p>
    </div>
  );

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {getMessage(messages, "host.notifications.list_heading")}
        </h2>
        {hasUnread && !listErrorMessage ? (
          <MarkAllNotificationsAsReadButton
            copy={{
              pending: getMessage(messages, "host.common.updating"),
              submit: getMessage(messages, "host.common.mark_all_read"),
            }}
            tenantId={tenantId}
          />
        ) : null}
      </div>

      {listErrorMessage ? (
        <SectionError
          description={listErrorMessage}
          title={getMessage(messages, "host.notifications.list_error")}
        />
      ) : null}

      {!listErrorMessage && notifications.length === 0 ? emptyState : null}

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
                    {getMessage(
                      messages,
                      item.isRead ? "host.common.read" : "host.common.unread"
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(item.createdAt, {
                      fallback: "-",
                      locale,
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
                    copy={{
                      ariaLabel: getMessage(
                        messages,
                        "host.notifications.mark_read_aria",
                        { title: item.title }
                      ),
                      pending: getMessage(messages, "host.common.updating"),
                      submit: getMessage(messages, "host.common.mark_read"),
                    }}
                    notificationId={item.id}
                    tenantId={tenantId}
                  />
                </div>
              )}
            </article>
          ))}
        </div>
      ) : null}

      {!listErrorMessage && notifications.length > 0 ? pagination : null}
    </section>
  );
};
