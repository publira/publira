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
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDate } from "@publira/utils";
import { Suspense } from "react";

import { AgeRatedVisibility } from "#components/age-rated-visibility";
import { EyeCatchFrame } from "#components/eye-catch-frame";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { RelativeTime } from "#components/relative-time";
import { redirectToLogin, requirePublicSession } from "#lib/auth-session";
import { listMyFollowUpdates } from "#lib/follow-updates";
import { getLocale } from "#lib/locale";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { myPageHref, resolveMyPageToken } from "../_lib/search-params";
import type { MyPageSearchParams } from "../_lib/search-params";

/** As many rows as the shelves below it show covers. */
const maxFollowUpdates = 6;

export const FollowUpdatesSectionSkeleton = ({
  count = maxFollowUpdates,
}: {
  count?: number;
}) => (
  <div className="divide-y divide-border">
    {Array.from({ length: count }, (_, index) => (
      <div className="flex items-center gap-4 py-3" key={index}>
        <Skeleton className="size-14 shrink-0 rounded-control" />
        <div className="flex-1 sm:flex sm:items-baseline sm:gap-4">
          <Skeleton className="h-4 w-2/3 sm:flex-1" />
          <div className="mt-2 flex items-baseline justify-between gap-3 sm:mt-0 sm:w-64 sm:shrink-0">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

/**
 * What has arrived since the reader was last here: the newly published
 * episodes of the series and the authors they follow.
 *
 * It is what My Page opens with, so it answers the question that brought the
 * reader back before anything else on the screen does. The page it sits on is
 * already behind a session, so a rejected session sends the reader back to
 * sign in rather than showing them the empty state of someone who follows
 * nothing.
 */
export const FollowUpdatesSection = async ({
  searchParams,
}: {
  searchParams: MyPageSearchParams;
}) => {
  const [tenantId, locale, token] = await Promise.all([
    getTenantId(),
    getLocale(),
    resolveMyPageToken(searchParams),
  ]);
  const returnTo = myPageHref(token);
  // This section is the page's first read of the reader's own data, so it is
  // where a visitor without a session is sent to sign in. The sections after
  // it answer for a guest as well, which is not what `/my` is.
  await requirePublicSession(locale, returnTo, tenantId);

  const [result, timeZone] = await Promise.all([
    listMyFollowUpdates(tenantId, { limit: maxFollowUpdates, locale }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok && result.requiresSignIn) {
    await redirectToLogin(locale, returnTo, tenantId);
  }

  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.my.follow_updates_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (result.updates.length === 0) {
    return (
      <EmptyState>
        <EmptyStateHeading>
          <EmptyStateTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message message="host.my.follow_updates_empty_title" />
            </Suspense>
          </EmptyStateTitle>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.my.follow_updates_empty_description" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyStateHeading>
      </EmptyState>
    );
  }

  return (
    <ol className="divide-y divide-border">
      {result.updates.map(({ episode, series }) => (
        <AgeRatedVisibility key={episode.publicId} rating={series.ageRating}>
          <li>
            <LocaleLink
              className="group flex items-center gap-4 py-3"
              href={`/series/${series.publicId}/episodes/${episode.publicId}`}
            >
              <EyeCatchFrame
                alt={series.title}
                className="size-14 shrink-0 rounded-control"
                sizes="56px"
                variants={series.eyeCatchImageVariants}
              />
              <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-4">
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                    <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
                      <Message
                        message="host.common.episode_number"
                        values={{ number: episode.orderIndex }}
                      />
                    </Suspense>
                  </span>
                  <span className="truncate underline-offset-4 group-hover:underline">
                    {episode.title}
                  </span>
                </span>
                <span className="flex items-baseline justify-between gap-3 text-sm text-muted-foreground sm:w-64 sm:shrink-0">
                  <span className="truncate">{series.title}</span>
                  <span className="shrink-0">
                    <RelativeTime
                      absolute={formatDate(episode.publishedAt, {
                        fallback: "",
                        locale,
                        timeZone,
                      })}
                      timeZone={timeZone}
                      value={episode.publishedAt}
                    />
                  </span>
                </span>
              </span>
            </LocaleLink>
          </li>
        </AgeRatedVisibility>
      ))}
    </ol>
  );
};
