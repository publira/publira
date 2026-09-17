import { toIntlLocale } from "@publira/i18n";
import { Button, buttonVariants } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { EyeCatchFrame } from "#components/eye-catch-frame";
import { FollowControlSkeleton } from "#components/follow-button";
import { FollowControl } from "#components/follow-control";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import type { EpisodeNeighborItem, EpisodeSeriesSummary } from "#lib/catalog";
import { getLocale } from "#lib/locale";

import { episodePath } from "../_lib/episode-path";

/**
 * The next episode, offered on the page after the last one as the reading
 * action: the facts the row under the reader gives, over a button the same
 * size as the other controls on this page.
 *
 * The whole block is one link, so the artwork and the title open the episode
 * as the button does. On the last published episode the button stays,
 * disabled but focusable, and says below it that the reader has caught up.
 */
export const EpisodeNextEpisodeOffer = async ({
  episodePublicId,
  nextEpisode,
  series,
  tenantId,
}: {
  episodePublicId: string;
  /** Absent on the last published episode of the series. */
  nextEpisode?: EpisodeNeighborItem;
  series: EpisodeSeriesSummary;
  tenantId: string;
}) => {
  if (nextEpisode === undefined) {
    return (
      <section className="grid justify-items-center gap-3 text-center">
        <Button disabled focusableWhenDisabled variant="secondary">
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="host.episode.navigation.next" />
          </Suspense>
        </Button>
        <h2 className="mt-3 font-serif text-xl leading-tight">
          <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
            <Message message="host.episode.end.up_to_date_title" />
          </Suspense>
        </h2>
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message
              message="host.episode.end.up_to_date_description"
              values={{ title: series.title }}
            />
          </Suspense>
        </p>
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.follow.control_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<FollowControlSkeleton />}>
            <FollowControl
              publicId={series.publicId}
              returnTo={episodePath(series.publicId, episodePublicId)}
              targetKind="series"
              targetName={series.title}
              tenantId={tenantId}
            />
          </Suspense>
        </SectionErrorBoundary>
      </section>
    );
  }

  const locale = await getLocale();

  return (
    <LocaleLink
      className="group grid w-full max-w-64 justify-items-center gap-3 text-center"
      href={episodePath(series.publicId, nextEpisode.publicId)}
    >
      <EyeCatchFrame
        alt=""
        className="aspect-16/9 w-full rounded-surface"
        preferredType="landscape"
        sizes="256px"
        variants={series.eyeCatchImageVariants}
      />
      <span className="grid gap-1">
        <span className="flex justify-center gap-3 text-sm text-muted-foreground tabular-nums">
          <span>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message
                message="host.common.episode_number"
                values={{ number: nextEpisode.orderIndex }}
              />
            </Suspense>
          </span>
          <span>
            {nextEpisode.isFree ? (
              <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
                <Message message="host.common.free" />
              </Suspense>
            ) : (
              `¥${nextEpisode.price.toLocaleString(toIntlLocale(locale))}`
            )}
          </span>
        </span>
        <span className="line-clamp-2 underline-offset-4 group-hover:underline">
          {nextEpisode.title}
        </span>
      </span>
      <span className={buttonVariants({ variant: "secondary" })}>
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message="host.episode.navigation.next" />
        </Suspense>
      </span>
    </LocaleLink>
  );
};
