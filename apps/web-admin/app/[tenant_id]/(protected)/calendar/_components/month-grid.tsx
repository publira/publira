import type { Locale } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  cn,
  formatPlainDate,
  formatWeekdayName,
  WEEKDAY_NUMBERS,
} from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { EpisodePublicationItem } from "#lib/publishing-calendar";

import { calendarMonthWeeks } from "../_lib/month";

/**
 * What an entry's status reads. The branch is written out here so each key
 * stays a literal at the point it is rendered.
 */
const StatusMessage = ({ status }: { status: "published" | "scheduled" }) => {
  if (status === "published") {
    return <Message message="admin.calendar.status_published" />;
  }

  return <Message message="admin.calendar.status_scheduled" />;
};

/**
 * Not prefetched. Each entry opens a different episode, and the server
 * prerenders an episode's App Shell the first time its URL is asked for, so a
 * month of a few dozen releases would cost that many renders as soon as it is
 * shown, for the one entry an operator opens.
 */
const EntryLink = ({ episode }: { episode: EpisodePublicationItem }) => (
  <Link
    className="grid min-w-0 gap-0.5 rounded-control px-1.5 py-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    href={`/series/${episode.seriesPublicId}/episodes/${episode.episodePublicId}`}
    prefetch={false}
  >
    <span className="line-clamp-2 text-xs break-words text-muted-foreground">
      {episode.seriesTitle}
    </span>
    <span className="line-clamp-3 text-sm font-medium break-words text-foreground">
      {episode.episodeTitle}
    </span>
    <Badge
      className="text-xs"
      tone={episode.status === "published" ? "success" : "info"}
      variant="outline"
    >
      <Suspense fallback={<SkeletonLine className="h-3 w-14" />}>
        <StatusMessage status={episode.status} />
      </Suspense>
    </Badge>
  </Link>
);

interface MonthGridProps {
  /** Each day's episodes, keyed `YYYY-MM-DD`. */
  days: ReadonlyMap<string, readonly EpisodePublicationItem[]>;
  locale: Locale;
  /** `YYYY-MM`. */
  month: string;
  /** The tenant's current day, `YYYY-MM-DD`. */
  today: string;
}

/**
 * The month as seven columns once the box it sits in is wide enough for an
 * entry to keep its titles, and as a list of the days that have something on
 * them where it is not. The width that decides it is the content area's, not
 * the window's, since the sidebar takes part of the window on a wide screen.
 *
 * Every day carries its whole date for a screen reader, so the weekday row
 * above the columns is drawing alone.
 */
export const MonthGrid = ({ days, locale, month, today }: MonthGridProps) => (
  <div className="@container">
    <div
      aria-hidden="true"
      className="hidden border-b border-border pb-2 text-xs text-muted-foreground @3xl:grid @3xl:grid-cols-7"
    >
      {WEEKDAY_NUMBERS.map((weekday) => (
        <span className="px-2.5" key={weekday}>
          {formatWeekdayName(weekday, { locale, style: "short" })}
        </span>
      ))}
    </div>
    <ol className="grid gap-4 @3xl:grid-cols-7 @3xl:gap-0">
      {calendarMonthWeeks(month)
        .flat()
        .map((day, index) => {
          if (day === null) {
            return (
              <li
                aria-hidden="true"
                className="hidden bg-muted/40 @3xl:block @3xl:border-b @3xl:border-border"
                key={`padding-${index}`}
              />
            );
          }

          const entries = days.get(day) ?? [];
          const isToday = day === today;

          return (
            <li
              aria-current={isToday ? "date" : undefined}
              className={cn(
                "grid content-start gap-1 @3xl:min-h-28 @3xl:border-b @3xl:border-border @3xl:p-1",
                entries.length === 0 && !isToday && "hidden @3xl:grid"
              )}
              key={day}
            >
              <h3 className="text-sm font-medium text-foreground @3xl:px-1.5 @3xl:pt-1">
                <time dateTime={day}>
                  <span
                    className={cn("@3xl:sr-only", isToday && "text-primary")}
                  >
                    {formatPlainDate(day, { locale })}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "hidden size-6 items-center justify-center rounded-control tabular-nums @3xl:inline-flex",
                      isToday && "bg-primary text-primary-foreground"
                    )}
                  >
                    {Number(day.slice("YYYY-MM-".length))}
                  </span>
                </time>
              </h3>
              {entries.length > 0 ? (
                <ul className="grid gap-1">
                  {entries.map((episode) => (
                    <li
                      key={`${episode.seriesPublicId}-${episode.episodePublicId}`}
                    >
                      <EntryLink episode={episode} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
    </ol>
  </div>
);
