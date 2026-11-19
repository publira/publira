import { Button, LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { EpisodePrice } from "#components/episode-price";
import { EyeCatchFrame } from "#components/eye-catch-frame";
import {
  FollowControlSkeleton,
  FollowControl,
} from "#components/follow-control";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import type { TenantSales } from "#lib/app-payments";
import type { EpisodeNeighborItem, EpisodeSeriesSummary } from "#lib/catalog";
import { getLocale } from "#lib/locale";

import { episodePath } from "../_lib/episode-path";
import { laterFreeEpisode } from "../_lib/next-free-episode";

/**
 * The next episode, offered on the page after the last one as the reading
 * action: the facts the row under the reader gives, over a button the same
 * size as the other controls on this page.
 *
 * The button is the block's one link to the episode, its hit area stretched
 * over the whole block, so the artwork and the title open the episode as the
 * button does and the facts above it describe the link rather than repeating
 * it. On the last published episode the button stays, disabled but focusable,
 * and says below it that the reader has caught up.
 *
 * Where the next episode is paid and a later one is free, a second button
 * beside it opens that one, so a reader who would rather not buy is not sent
 * back to the series page to find it. It is outlined rather than filled: the
 * next episode stays the reading action, the one filled button the page has.
 */
export const EpisodeNextEpisodeOffer = async ({
  episodePublicId,
  nextEpisode,
  nextFreeEpisode,
  sales,
  series,
  tenantId,
  timeZone,
}: {
  episodePublicId: string;
  /** Absent on the last published episode of the series. */
  nextEpisode?: EpisodeNeighborItem;
  /**
   * The first later episode every reader may open, as `GetEpisodeDetail`
   * names it; absent when none is.
   */
  nextFreeEpisode?: EpisodeNeighborItem;
  /** Where the tenant can sell an episode right now. */
  sales: TenantSales;
  series: EpisodeSeriesSummary;
  tenantId: string;
  /** The tenant's time zone, which the end of a campaign is written in. */
  timeZone: string;
}) => {
  if (nextEpisode === undefined) {
    return (
      <section className="grid justify-items-center gap-3 text-center">
        <Button disabled focusableWhenDisabled variant="secondary">
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="storefront.episode.navigation.next" />
          </Suspense>
        </Button>
        <h2 className="mt-3 font-serif text-xl leading-tight">
          <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
            <Message message="storefront.episode.end.up_to_date_title" />
          </Suspense>
        </h2>
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message
              message="storefront.episode.end.up_to_date_description"
              values={{ title: series.title }}
            />
          </Suspense>
        </p>
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.follow.control_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<FollowControlSkeleton />}>
            <FollowControl
              targetId={series.id}
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

  const freeEpisode = laterFreeEpisode(nextEpisode, nextFreeEpisode);

  const factsId = `next-episode-${nextEpisode.publicId}`;

  return (
    <div className="group relative grid w-full max-w-sm justify-items-center gap-3 text-center">
      <EyeCatchFrame
        alt=""
        className="aspect-16/9 w-full max-w-64 rounded-surface"
        preferredType="landscape"
        sizes="256px"
        variants={series.eyeCatchImageVariants}
      />
      <span className="grid max-w-64 gap-1" id={factsId}>
        <span className="flex justify-center gap-3 text-sm text-muted-foreground tabular-nums">
          <span>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message
                message="storefront.common.episode_number"
                values={{ number: nextEpisode.orderIndex }}
              />
            </Suspense>
          </span>
          <span>
            <EpisodePrice
              campaign={nextEpisode.campaign}
              sales={sales}
              locale={locale}
              price={nextEpisode.isFree ? 0 : nextEpisode.price}
              purchaseSurface={nextEpisode.purchaseSurface}
              timeZone={timeZone}
            />
          </span>
        </span>
        <span className="line-clamp-2 underline-offset-4 group-hover:underline">
          {nextEpisode.title}
        </span>
      </span>
      <span className="flex flex-wrap justify-center gap-3">
        <LinkButton
          aria-describedby={factsId}
          className="after:absolute after:inset-0"
          render={
            <LocaleLink
              href={episodePath(series.publicId, nextEpisode.publicId)}
            />
          }
          variant="secondary"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="storefront.episode.navigation.next" />
          </Suspense>
        </LinkButton>
        {freeEpisode ? (
          // Positioned, so it sits above the next episode's stretched hit area
          // rather than under it.
          <LinkButton
            className="relative"
            render={
              <LocaleLink
                href={episodePath(series.publicId, freeEpisode.publicId)}
              />
            }
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message
                message="storefront.episode.end.next_free_episode"
                values={{ number: freeEpisode.orderIndex }}
              />
            </Suspense>
          </LinkButton>
        ) : null}
      </span>
    </div>
  );
};
