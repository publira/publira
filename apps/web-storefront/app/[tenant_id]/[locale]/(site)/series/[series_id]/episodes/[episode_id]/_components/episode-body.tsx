import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";
import { resolveAccessToken } from "#lib/api-client";
import { toTenantSales } from "#lib/app-payments";
import type { TenantAppPayments } from "#lib/app-payments";
import type {
  EpisodeAccessState,
  EpisodeDetail,
  EpisodeImageItem,
  EpisodeNeighborItem,
  EpisodeSeriesSummary,
  SeriesCommentMode,
  SeriesWaitFreeRule,
} from "#lib/catalog";
import { getEpisodeViewer, isPublicEpisodeBody } from "#lib/catalog";
import { getCoinSettings, getMyCoinBalance } from "#lib/coins";
import { getLocale } from "#lib/locale";
import type { TenantImageVariant } from "#lib/tenant";
import { getMyWaitFreeTicketState } from "#lib/wait-free";

import { episodeOffersCoins, toCoinOffer } from "../_lib/coin-offer";
import { toPromotionCodeOffer } from "../_lib/promotion-code-offer";
import { renewEpisodePageUrlsAction } from "../_lib/renew-page-urls-action";
import { offersSubscription } from "../_lib/subscription-offer";
import {
  toWaitFreeOffer,
  waitFreeEpisodeEligible,
} from "../_lib/wait-free-offer";
import { EpisodeAccessGate } from "./episode-access-gate";
import { EpisodeBodyNotice } from "./episode-body-notice";
import { EpisodeGateFrame } from "./episode-gate-frame";
import { EpisodePreviewViewer } from "./episode-preview-viewer";
import { EpisodeViewer } from "./episode-viewer";

/**
 * Where the gate stands: after the episode's preview pages, as the page the
 * reader turns to once they run out, or, where the episode opens none, over
 * the blurred opening pages in place of the reader.
 */
const EpisodeGatePlacement = ({
  children,
  episode,
  nextEpisode,
  previewImages,
  previewPages,
  previousEpisode,
  series,
}: {
  /** The gate, told with `previewEnded` whether `previewPages` precede it. */
  children: ReactNode;
  episode: EpisodeDetail;
  nextEpisode?: EpisodeNeighborItem;
  previewImages: EpisodeImageItem[];
  previewPages: EpisodeImageItem[];
  previousEpisode?: EpisodeNeighborItem;
  series: EpisodeSeriesSummary;
}) =>
  previewPages.length > 0 ? (
    <EpisodePreviewViewer
      episode={episode}
      gate={<div className="text-center">{children}</div>}
      nextEpisode={nextEpisode}
      previewPages={previewPages}
      previousEpisode={previousEpisode}
      series={series}
    />
  ) : (
    <EpisodeGateFrame
      previewImages={previewImages}
      readingDirection={episode.readingDirection}
    >
      {children}
    </EpisodeGateFrame>
  );

export const EpisodeBody = async ({
  acceptsPayments,
  acceptsPromotionCodes,
  access,
  appPayments,
  appStoreBadge,
  appStoreUrl,
  checkoutSessionId,
  commentMode,
  commentToken,
  currency,
  episode,
  googlePlayBadge,
  googlePlayUrl,
  images,
  labelPublicId,
  nextEpisode,
  nextFreeEpisode,
  previewImages,
  previewPages,
  previousEpisode,
  promotionCode,
  series,
  taxIncluded,
  tenantId,
  timeZone,
  waitFree,
}: {
  acceptsPayments: boolean;
  /** Whether the tenant holds a promotion code a reader could enter. */
  acceptsPromotionCodes: boolean;
  access: EpisodeAccessState;
  /** Where the tenant's app can sell an episode the site sends there. */
  appPayments: TenantAppPayments;
  /** The badge the tenant uploaded for each store's link, where it did. */
  appStoreBadge?: TenantImageVariant;
  /** Where the tenant's app is listed, for an episode the site sends there. */
  appStoreUrl?: string;
  checkoutSessionId: string;
  /** Passed to the viewer, which ends the episode on the comment section. */
  commentMode: SeriesCommentMode;
  /** Cursor of the comment page the URL asks for. Empty on the newest page. */
  commentToken: string;
  /**
   * The currency the viewer's end panel and the gate quote a price in, `null`
   * while the tenant could not be read.
   */
  currency: string | null;
  episode: EpisodeDetail;
  googlePlayBadge?: TenantImageVariant;
  googlePlayUrl?: string;
  images: EpisodeImageItem[];
  /**
   * The label the series is filed under, which a plan of labels is matched
   * against; empty for a series under none, or while the series read failed.
   */
  labelPublicId: string;
  /** Absent at the ends of the series; the viewer's own chrome links to them. */
  nextEpisode?: EpisodeNeighborItem;
  /** What the gate offers instead of a locked body, when there is one. */
  nextFreeEpisode?: EpisodeNeighborItem;
  /** The blurred opening pages the gate is drawn over. */
  previewImages: EpisodeImageItem[];
  /**
   * The opening pages the shared read opens to every reader as a preview,
   * which a guest turns before meeting the gate.
   */
  previewPages: EpisodeImageItem[];
  previousEpisode?: EpisodeNeighborItem;
  /** The promotion code the URL carries for the gate; empty where none. */
  promotionCode: string;
  series: EpisodeSeriesSummary;
  /** Whether the tenant states a tax rate, which every price includes. */
  taxIncluded: boolean;
  tenantId: string;
  /** The tenant's time zone, for the instant a recharging ticket is ready. */
  timeZone: string;
  /** The series' wait-for-free rule; absent when it offers none. */
  waitFree?: SeriesWaitFreeRule;
}) => {
  if (isPublicEpisodeBody(access)) {
    return (
      <EpisodeViewer
        sales={toTenantSales({
          acceptsPayments,
          appPayments,
          currency,
          taxIncluded,
        })}
        commentMode={commentMode}
        commentToken={commentToken}
        episode={episode}
        images={images}
        nextEpisode={nextEpisode}
        previousEpisode={previousEpisode}
        series={series}
        timeZone={timeZone}
      />
    );
  }

  const [locale, sessionId] = await Promise.all([
    getLocale(),
    resolveAccessToken(),
  ]);

  const subscription = {
    acceptsPayments,
    labelPublicId,
    seriesPublicId: series.publicId,
  };

  if (!sessionId) {
    return (
      <EpisodeGatePlacement
        episode={episode}
        nextEpisode={nextEpisode}
        previewImages={previewImages}
        previewPages={previewPages}
        previousEpisode={previousEpisode}
        series={series}
      >
        <EpisodeAccessGate
          acceptsPayments={acceptsPayments}
          appPayments={appPayments}
          appStoreBadge={appStoreBadge}
          appStoreUrl={appStoreUrl}
          campaign={episode.campaign}
          currency={currency}
          episodeId={episode.id}
          episodePublicId={episode.publicId}
          googlePlayBadge={googlePlayBadge}
          googlePlayUrl={googlePlayUrl}
          locale={locale}
          nextFreeEpisode={nextFreeEpisode}
          previewEnded={previewPages.length > 0}
          price={episode.price}
          purchaseSurface={episode.purchaseSurface}
          rentalPeriodHours={episode.rentalPeriodHours}
          rentalPrice={episode.rentalPrice}
          seriesPublicId={series.publicId}
          signedIn={false}
          subscribable={await offersSubscription(
            tenantId,
            locale,
            subscription
          )}
          taxIncluded={taxIncluded}
          tenantId={tenantId}
          timeZone={timeZone}
          waitFree={toWaitFreeOffer({
            episodeId: episode.id,
            rule: waitFree,
            ticketState: undefined,
          })}
        />
      </EpisodeGatePlacement>
    );
  }

  const viewer = await getEpisodeViewer(
    tenantId,
    series.publicId,
    episode.publicId,
    sessionId,
    locale,
    checkoutSessionId
  );

  if (!viewer.ok) {
    return (
      <EpisodeBodyNotice>
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="storefront.episode.body_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {viewer.message}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      </EpisodeBodyNotice>
    );
  }

  if (!viewer.value) {
    notFound();
  }

  // A free body the age rule withheld from the shared read comes back as free
  // once the reader behind the bearer clears it, so both openings are read here.
  if (
    viewer.value.access === "entitled" ||
    isPublicEpisodeBody(viewer.value.access)
  ) {
    return (
      <EpisodeViewer
        sales={toTenantSales({
          acceptsPayments,
          appPayments,
          currency,
          taxIncluded,
        })}
        commentMode={commentMode}
        commentToken={commentToken}
        episode={episode}
        images={viewer.value.images}
        nextEpisode={nextEpisode}
        previousEpisode={previousEpisode}
        renewPageUrls={
          // Only an entitled body's media token runs out while the episode is
          // open: a free body's lasts days.
          viewer.value.access === "entitled"
            ? renewEpisodePageUrlsAction.bind(
                null,
                tenantId,
                locale,
                series.publicId,
                episode.publicId
              )
            : undefined
        }
        series={series}
        timeZone={timeZone}
      />
    );
  }

  // Asked only where a ticket could open the episode: the rule says on its
  // own that it keeps one off the latest episodes, whoever the reader is. The
  // coins are asked only where the episode is priced in them, which it is only
  // while the tenant offers them.
  const coinsOffered = episodeOffersCoins(episode);

  const [ticketState, coinBalance, coinSettings, promotionCodeOffer] =
    await Promise.all([
      waitFreeEpisodeEligible(waitFree, episode.id)
        ? getMyWaitFreeTicketState(tenantId, series.id, sessionId, locale)
        : undefined,
      coinsOffered ? getMyCoinBalance(tenantId, locale) : undefined,
      coinsOffered ? getCoinSettings(tenantId, locale) : undefined,
      toPromotionCodeOffer({
        acceptsPayments,
        acceptsPromotionCodes,
        appPayments,
        code: promotionCode,
        episode,
        sessionId,
        tenantId,
      }),
    ]);

  const coinOffer = coinBalance
    ? toCoinOffer({
        acceptsPayments,
        balance: coinBalance,
        episode,
        // A key per rendering of the gate: a second tap of the button it
        // renders sends the same one, and spends nothing more.
        idempotencyKey: crypto.randomUUID(),
        settings: coinSettings?.ok ? coinSettings.value : null,
      })
    : undefined;

  return (
    <EpisodeGatePlacement
      episode={episode}
      nextEpisode={nextEpisode}
      previewImages={previewImages}
      previewPages={viewer.value.previewPages}
      previousEpisode={previousEpisode}
      series={series}
    >
      <EpisodeAccessGate
        acceptsPayments={acceptsPayments}
        appPayments={appPayments}
        appStoreBadge={appStoreBadge}
        appStoreUrl={appStoreUrl}
        campaign={episode.campaign}
        coinOffer={coinOffer}
        currency={currency}
        episodeId={episode.id}
        episodePublicId={episode.publicId}
        googlePlayBadge={googlePlayBadge}
        googlePlayUrl={googlePlayUrl}
        locale={locale}
        nextFreeEpisode={nextFreeEpisode}
        previewEnded={viewer.value.previewPages.length > 0}
        price={episode.price}
        promotionCode={promotionCodeOffer}
        purchaseSurface={episode.purchaseSurface}
        rentalPeriodHours={episode.rentalPeriodHours}
        rentalPrice={episode.rentalPrice}
        seriesPublicId={series.publicId}
        signedIn
        subscribable={await offersSubscription(tenantId, locale, subscription)}
        taxIncluded={taxIncluded}
        tenantId={tenantId}
        timeZone={timeZone}
        waitFree={toWaitFreeOffer({
          episodeId: episode.id,
          rule: waitFree,
          ticketState,
        })}
      />
    </EpisodeGatePlacement>
  );
};
