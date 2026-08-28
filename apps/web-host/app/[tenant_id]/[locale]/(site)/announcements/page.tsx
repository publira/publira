import { getMessage } from "@publira/i18n";
import { SectionError } from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import type { Metadata } from "next";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listMyAnnouncements } from "#lib/announcements";
import { redirectToLogin } from "#lib/auth-session";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  markAllAnnouncementsAsReadAction,
  markAnnouncementAsReadAction,
  markAnnouncementAsReadAndNavigateAction,
} from "./_lib/actions";
import {
  announcementsListHref,
  parseAnnouncementsListSearchParams,
} from "./_lib/search-params";

const ANNOUNCEMENTS_PAGE_SIZE = 20;

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.announcements.title") };
};

/*
 * The session id is left to `resolveAccessToken()` inside `#lib/announcements`.
 * The `publira_web_host_auth` cookie holds an *encrypted* session payload, not
 * a bearer token, so reading it here and passing the raw value on made every
 * call fail `unauthenticated`; only the library's own cookie path decrypts it.
 */

/**
 * Resolves the catalog itself rather than taking it as a prop: every caller
 * already sits inside the section's own boundary, and the `aria-label` cannot
 * stream in any case.
 */
const AnnouncementsPagination = async ({
  nextToken,
  previousToken,
}: {
  nextToken: string;
  previousToken: string;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <nav
      aria-label={getMessage(messages, "host.announcements.pagination_aria")}
      className="mt-6 flex items-center justify-center gap-6"
    >
      {previousToken ? (
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={announcementsListHref(previousToken)}
        >
          {getMessage(messages, "host.common.previous_page")}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          {getMessage(messages, "host.common.previous_page")}
        </span>
      )}

      {nextToken ? (
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={announcementsListHref(nextToken)}
        >
          {getMessage(messages, "host.common.next_page")}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          {getMessage(messages, "host.common.next_page")}
        </span>
      )}
    </nav>
  );
};

const AnnouncementsEmptyState = async ({
  nextToken,
  previousToken,
  token,
}: {
  nextToken: string;
  previousToken: string;
  token: string;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  if (!token) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
        {getMessage(messages, "host.announcements.list_empty")}
      </div>
    );
  }

  // The rows this page pointed at are gone. The server hands back a token for
  // the neighbouring page when it can, and empty tokens when it cannot — then
  // the only way out is the first page (`proto/README.md`).
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-center text-sm text-muted-foreground">
      <p>{getMessage(messages, "host.announcements.page_empty")}</p>
      {previousToken || nextToken ? (
        <AnnouncementsPagination
          nextToken={nextToken}
          previousToken={previousToken}
        />
      ) : (
        <LocaleLink
          className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
          href={announcementsListHref("")}
        >
          {getMessage(messages, "host.announcements.first_page")}
        </LocaleLink>
      )}
    </div>
  );
};

const AnnouncementsSection = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/[locale]/announcements">["searchParams"];
}) => {
  const [resolvedSearchParams, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const { token } = parseAnnouncementsListSearchParams(resolvedSearchParams);

  const [result, timeZone, messages] = await Promise.all([
    listMyAnnouncements(tenantId, undefined, {
      limit: ANNOUNCEMENTS_PAGE_SIZE,
      locale,
      token,
    }),
    getTenantDisplayTimeZone(tenantId),
    loadHostMessages(locale),
  ]);
  if (!result.ok && result.requiresSignIn) {
    // Come back to the page the reader was actually on, not just the first one.
    redirectToLogin(locale, announcementsListHref(token));
  }

  const { nextToken, previousToken } = result;
  // Only this page's rows are loaded, so this is a per-page count. A total
  // would need its own RPC, which the cursor contract deliberately leaves out
  // (`proto/README.md`).
  const unreadCount = result.announcements.filter(
    (item) => !item.isRead
  ).length;

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {getMessage(messages, "host.announcements.list_heading")}
        </h2>
        <div className="flex items-center gap-2">
          <span
            className={
              unreadCount > 0
                ? "rounded-full bg-info px-3 py-1 text-xs font-medium text-info-foreground"
                : "rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
            }
          >
            {getMessage(messages, "host.announcements.unread_on_page", {
              count: String(unreadCount),
            })}
          </span>
          {result.announcements.length > 0 ? (
            // Offered on every non-empty page: the unread count above covers
            // this page only, so a page with nothing unread can still sit in
            // front of unread announcements further down the list.
            <form action={markAllAnnouncementsAsReadAction}>
              <LocaleField />
              <input name="tenantId" type="hidden" value={tenantId} />
              <button
                className="inline-flex rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                type="submit"
              >
                {getMessage(messages, "host.common.mark_all_read")}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {result.ok ? null : (
        <SectionError
          className="mb-4"
          description={result.message}
          title={getMessage(messages, "host.announcements.list_error")}
        />
      )}

      {/*
        A failed read hands back an empty `announcements`, so the empty state
        stays behind `result.ok` — otherwise the page says the list could not
        be read and that there is nothing to read, one after the other.
      */}
      {result.ok && result.announcements.length === 0 ? (
        <AnnouncementsEmptyState
          nextToken={nextToken}
          previousToken={previousToken}
          token={token}
        />
      ) : null}

      {result.announcements.length > 0 ? (
        <div className="grid gap-3">
          {result.announcements.map((announcement) => {
            const linkAction = (() => {
              if (!announcement.linkUrl) {
                return null;
              }

              if (announcement.isRead) {
                return (
                  <LocaleLink
                    className="inline-flex rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                    href={announcement.linkUrl}
                  >
                    {getMessage(messages, "host.announcements.open_link")}
                  </LocaleLink>
                );
              }

              return (
                <form action={markAnnouncementAsReadAndNavigateAction}>
                  <LocaleField />
                  <input name="tenantId" type="hidden" value={tenantId} />
                  <input
                    name="announcementId"
                    type="hidden"
                    value={announcement.id}
                  />
                  <button
                    className="inline-flex rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                    type="submit"
                  >
                    {getMessage(
                      messages,
                      "host.announcements.open_and_mark_read"
                    )}
                  </button>
                </form>
              );
            })();

            return (
              <article
                className="rounded-xl border border-border/70 bg-background p-4"
                key={announcement.id}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="font-medium">{announcement.title}</h3>
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        announcement.isRead
                          ? "rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
                          : "rounded-full bg-info px-2 py-1 text-xs font-medium text-info-foreground"
                      }
                    >
                      {getMessage(
                        messages,
                        announcement.isRead
                          ? "host.common.read"
                          : "host.common.unread"
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(announcement.createdAt, {
                        fallback: "-",
                        locale,
                        timeZone,
                      })}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {announcement.body}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {announcement.isRead ? null : (
                    <form action={markAnnouncementAsReadAction}>
                      <LocaleField />
                      <input name="tenantId" type="hidden" value={tenantId} />
                      <input
                        name="announcementId"
                        type="hidden"
                        value={announcement.id}
                      />
                      <button
                        className="inline-flex rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                        type="submit"
                      >
                        {getMessage(messages, "host.common.mark_read")}
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

      {result.announcements.length > 0 ? (
        <AnnouncementsPagination
          nextToken={nextToken}
          previousToken={previousToken}
        />
      ) : null}
    </section>
  );
};

const AnnouncementsSectionFallback = () => (
  <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
    <SkeletonLine className="mb-4 h-6 w-32" />
    <div className="h-24 w-full animate-pulse rounded-md bg-muted" />
  </section>
);

const AnnouncementsPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/announcements">) => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <h1 className="text-xl font-semibold">
        <Suspense fallback={<SkeletonLine className="h-6 w-24" />}>
          <Message message="host.announcements.title" />
        </Suspense>
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          <Message message="host.announcements.description" />
        </Suspense>
      </p>
    </section>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
          <Message message="host.announcements.list_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<AnnouncementsSectionFallback />}>
        <AnnouncementsSection searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </div>
);

export default AnnouncementsPage;
