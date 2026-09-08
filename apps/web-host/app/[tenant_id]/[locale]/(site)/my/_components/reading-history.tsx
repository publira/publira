import { getMessage } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { redirectToLogin } from "#lib/auth-session";
import { getLocale, loadHostMessages } from "#lib/locale";
import { listMyEpisodeReads } from "#lib/reading-history";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  defaultReadingHistoryPageSize,
  readingHistoryHref,
} from "../_lib/search-params";

/**
 * The heading names the section, which is what turns the `<section>` into a
 * landmark a reader can jump to and a test can scope to. `/my` renders this
 * section once, so the id is a constant rather than a generated one.
 */
const HISTORY_HEADING_ID = "reading-history-heading";

/**
 * The episodes this reader has finished, most recent first.
 *
 * It is the only place a reader is told what they have read: `/my/library`
 * lists purchases, and a free episode is never one. The page it sits on is
 * already behind a session, so a rejected session sends the reader back to sign
 * in rather than showing them the empty state of someone who has read nothing.
 */
export const ReadingHistorySection = async ({ token }: { token: string }) => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [result, messages, timeZone] = await Promise.all([
    listMyEpisodeReads(tenantId, {
      limit: defaultReadingHistoryPageSize,
      locale,
      token,
    }),
    loadHostMessages(locale),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok && result.requiresSignIn) {
    await redirectToLogin(locale, readingHistoryHref(token), tenantId);
  }

  return (
    <section
      aria-labelledby={HISTORY_HEADING_ID}
      className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm"
    >
      <h2 className="mb-4 text-lg font-semibold" id={HISTORY_HEADING_ID}>
        {getMessage(messages, "host.my.history_heading")}
      </h2>
      {result.ok ? null : (
        <SectionError>
          <SectionErrorHeading>
            <SectionErrorTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="host.my.history_error" />
              </Suspense>
            </SectionErrorTitle>
            <SectionErrorDescription>{result.message}</SectionErrorDescription>
          </SectionErrorHeading>
        </SectionError>
      )}
      {result.ok && result.reads.length === 0 ? (
        <EmptyState>
          <EmptyStateHeading>
            <EmptyStateTitle>
              {getMessage(messages, "host.my.history_empty_title")}
            </EmptyStateTitle>
            <EmptyStateDescription>
              {getMessage(messages, "host.my.history_empty_description")}
            </EmptyStateDescription>
          </EmptyStateHeading>
        </EmptyState>
      ) : null}
      {result.ok && result.reads.length > 0 ? (
        <ol className="grid gap-3">
          {result.reads.map((read) => (
            <li
              className="rounded-xl border border-border/70 bg-background p-4"
              key={read.episode.publicId}
            >
              <p className="text-xs text-muted-foreground">
                {read.series.title}
              </p>
              <h3 className="mt-1 font-medium">
                <LocaleLink
                  className="hover:underline"
                  href={`/series/${read.series.publicId}/episodes/${read.episode.publicId}`}
                >
                  #{read.episode.orderIndex} {read.episode.title}
                </LocaleLink>
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {getMessage(messages, "host.my.history_finished_at")}{" "}
                <span className="text-foreground">
                  {formatDateTime(read.readAt, {
                    fallback: "-",
                    locale,
                    timeZone,
                  })}
                </span>
              </p>
            </li>
          ))}
        </ol>
      ) : null}
      {result.ok && result.reads.length > 0 ? (
        <nav
          aria-label={getMessage(messages, "host.my.history_pagination_aria")}
          className="mt-6 flex items-center justify-center gap-6"
        >
          {result.previousToken ? (
            <LocaleLink
              className="text-sm text-primary underline-offset-4 hover:underline"
              href={readingHistoryHref(result.previousToken)}
            >
              {getMessage(messages, "host.common.previous_page")}
            </LocaleLink>
          ) : (
            <span className="text-sm text-muted-foreground">
              {getMessage(messages, "host.common.previous_page")}
            </span>
          )}
          {result.nextToken ? (
            <LocaleLink
              className="text-sm text-primary underline-offset-4 hover:underline"
              href={readingHistoryHref(result.nextToken)}
            >
              {getMessage(messages, "host.common.next_page")}
            </LocaleLink>
          ) : (
            <span className="text-sm text-muted-foreground">
              {getMessage(messages, "host.common.next_page")}
            </span>
          )}
        </nav>
      ) : null}
    </section>
  );
};
