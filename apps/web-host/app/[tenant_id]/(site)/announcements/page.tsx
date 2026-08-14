import { SectionError } from "@publira/ui-components/section-error";
import { formatDateTime } from "@publira/utils";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listMyAnnouncements } from "#lib/announcements";
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

/*
 * The session id is left to `resolveAccessToken()` inside `#lib/announcements`.
 * The `publira_web_host_auth` cookie holds an *encrypted* session payload, not
 * a bearer token, so reading it here and passing the raw value on made every
 * call fail `unauthenticated`; only the library's own cookie path decrypts it.
 */

const AnnouncementsPagination = ({
  nextToken,
  previousToken,
}: {
  nextToken: string;
  previousToken: string;
}) => (
  <nav
    aria-label="お知らせ一覧ページング"
    className="mt-6 flex items-center justify-center gap-6"
  >
    {previousToken ? (
      <Link
        className="text-sm text-primary underline-offset-4 hover:underline"
        href={announcementsListHref(previousToken)}
      >
        前のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">前のページ</span>
    )}

    {nextToken ? (
      <Link
        className="text-sm text-primary underline-offset-4 hover:underline"
        href={announcementsListHref(nextToken)}
      >
        次のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">次のページ</span>
    )}
  </nav>
);

const AnnouncementsEmptyState = ({
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
        現在表示できるお知らせはありません。
      </div>
    );
  }

  // The rows this page pointed at are gone. The server hands back a token for
  // the neighbouring page when it can, and empty tokens when it cannot — then
  // the only way out is the first page (`proto/README.md`).
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-5 text-center text-sm text-muted-foreground">
      <p>このページに表示できるお知らせがありません。</p>
      {previousToken || nextToken ? (
        <AnnouncementsPagination
          nextToken={nextToken}
          previousToken={previousToken}
        />
      ) : (
        <Link
          className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
          href={announcementsListHref("")}
        >
          お知らせ一覧の先頭へ
        </Link>
      )}
    </div>
  );
};

const AnnouncementsSection = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/announcements">["searchParams"];
}) => {
  const [resolvedSearchParams, tenantId] = await Promise.all([
    searchParams,
    getTenantId(),
  ]);
  const { token } = parseAnnouncementsListSearchParams(resolvedSearchParams);
  await connection();

  const [result, timeZone] = await Promise.all([
    listMyAnnouncements(tenantId, undefined, {
      limit: ANNOUNCEMENTS_PAGE_SIZE,
      token,
    }),
    getTenantDisplayTimeZone(tenantId),
  ]);
  if (!result.ok && result.requiresSignIn) {
    // Come back to the page the reader was actually on, not just the first one.
    redirect(
      `/login?returnTo=${encodeURIComponent(announcementsListHref(token))}`
    );
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
        <h2 className="text-lg font-semibold">お知らせ一覧</h2>
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
          {result.announcements.length > 0 ? (
            // Offered on every non-empty page: the unread count above covers
            // this page only, so a page with nothing unread can still sit in
            // front of unread announcements further down the list.
            <form action={markAllAnnouncementsAsReadAction}>
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
          title="お知らせ一覧を表示できませんでした"
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
                  <Link
                    className="inline-flex rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                    href={announcement.linkUrl}
                  >
                    遷移先を開く
                  </Link>
                );
              }

              return (
                <form action={markAnnouncementAsReadAndNavigateAction}>
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
                    開いて既読にする
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
                      {announcement.isRead ? "既読" : "未読"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(announcement.createdAt, {
                        fallback: "-",
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
    <h2 className="mb-4 text-lg font-semibold">お知らせ一覧</h2>
    <div className="h-24 w-full animate-pulse rounded-md bg-muted" />
  </section>
);

const AnnouncementsPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/announcements">) => (
  <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
      <h1 className="text-xl font-semibold">お知らせ</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        運営から配信されたお知らせを確認できます。
      </p>
    </section>

    <SectionErrorBoundary title="お知らせ一覧を表示できませんでした">
      <Suspense fallback={<AnnouncementsSectionFallback />}>
        <AnnouncementsSection searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </div>
);

export default AnnouncementsPage;
