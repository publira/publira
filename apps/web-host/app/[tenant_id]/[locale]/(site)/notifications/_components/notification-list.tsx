import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import {
  ListPagination,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";

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
 * The whole list resolves the accessor once, and the pieces that repeat — the
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
  const t = await getMessagesFor(locale);
  const hasUnread =
    unreadCount > 0 || notifications.some((item) => !item.isRead);

  const pagination = (
    <ListPagination aria-label={t("host.notifications.pagination_aria")}>
      <ListPaginationStep
        href={previousToken ? notificationsListHref(previousToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep
        href={nextToken ? notificationsListHref(nextToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
        </Suspense>
      </ListPaginationStep>
    </ListPagination>
  );

  // The rows this page pointed at are gone. The server hands back a token for
  // the neighbouring page when it can, and empty tokens when it cannot — then
  // the only way out is the first page (`proto/README.md`).
  const emptyState = token ? (
    <div className="grid gap-6">
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-center text-sm text-muted-foreground">
        <p>{t("host.notifications.page_empty")}</p>
        {previousToken || nextToken ? null : (
          <LocaleLink
            className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
            href={notificationsListHref("")}
          >
            {t("host.notifications.first_page")}
          </LocaleLink>
        )}
      </div>
      {previousToken || nextToken ? pagination : null}
    </div>
  ) : (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">
        {t("host.notifications.empty_title")}
      </p>
      <p className="mt-1">{t("host.notifications.empty_description")}</p>
    </div>
  );

  return (
    <section className="border border-border bg-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {t("host.notifications.list_heading")}
        </h2>
        {hasUnread && !listErrorMessage ? (
          <MarkAllNotificationsAsReadButton tenantId={tenantId} />
        ) : null}
      </div>

      {listErrorMessage ? (
        <SectionError>
          <SectionErrorHeading>
            <SectionErrorTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="host.notifications.list_error" />
              </Suspense>
            </SectionErrorTitle>
            <SectionErrorDescription>
              {listErrorMessage}
            </SectionErrorDescription>
          </SectionErrorHeading>
        </SectionError>
      ) : null}

      {!listErrorMessage && notifications.length === 0 ? emptyState : null}

      {notifications.length > 0 ? (
        <div className="grid gap-6">
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
                      {item.isRead
                        ? t("host.common.read")
                        : t("host.common.unread")}
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
                      aria-label={t("host.notifications.mark_read_aria", {
                        title: item.title,
                      })}
                      notificationId={item.id}
                      tenantId={tenantId}
                    />
                  </div>
                )}
              </article>
            ))}
          </div>
          {listErrorMessage ? null : pagination}
        </div>
      ) : null}
    </section>
  );
};
