import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Message } from "#components/message";
import { resolveAccessToken } from "#lib/api-client";
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
import { getLocale } from "#lib/locale";
import { getMyWaitFreeTicketState } from "#lib/wait-free";

import {
  toWaitFreeOffer,
  waitFreeEpisodeEligible,
} from "../_lib/wait-free-offer";
import { EpisodeAccessGate } from "./episode-access-gate";
import { EpisodeBodyNotice } from "./episode-body-notice";
import { EpisodeGateFrame } from "./episode-gate-frame";
import { EpisodeViewer } from "./episode-viewer";

export const EpisodeBody = async ({
  acceptsPayments,
  access,
  appStoreUrl,
  checkoutSessionId,
  commentMode,
  commentToken,
  episode,
  googlePlayUrl,
  images,
  nextEpisode,
  nextFreeEpisode,
  previewImages,
  previousEpisode,
  series,
  tenantId,
  timeZone,
  waitFree,
}: {
  acceptsPayments: boolean;
  access: EpisodeAccessState;
  /** Where the tenant's app is listed, for an episode sold there alone. */
  appStoreUrl?: string;
  checkoutSessionId: string;
  /** Passed to the viewer, which ends the episode on the comment section. */
  commentMode: SeriesCommentMode;
  /** Cursor of the comment page the URL asks for. Empty on the newest page. */
  commentToken: string;
  episode: EpisodeDetail;
  googlePlayUrl?: string;
  images: EpisodeImageItem[];
  /** Absent at the ends of the series; the viewer's own chrome links to them. */
  nextEpisode?: EpisodeNeighborItem;
  /** What the gate offers instead of a locked body, when there is one. */
  nextFreeEpisode?: EpisodeNeighborItem;
  /** The blurred opening pages the gate is drawn over. */
  previewImages: EpisodeImageItem[];
  previousEpisode?: EpisodeNeighborItem;
  series: EpisodeSeriesSummary;
  tenantId: string;
  /** The tenant's time zone, for the instant a recharging ticket is ready. */
  timeZone: string;
  /** The series' wait-for-free rule; absent when it offers none. */
  waitFree?: SeriesWaitFreeRule;
}) => {
  if (isPublicEpisodeBody(access)) {
    return (
      <EpisodeViewer
        commentMode={commentMode}
        commentToken={commentToken}
        episode={episode}
        images={images}
        nextEpisode={nextEpisode}
        previousEpisode={previousEpisode}
        series={series}
      />
    );
  }

  const [locale, sessionId] = await Promise.all([
    getLocale(),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return (
      <EpisodeGateFrame
        previewImages={previewImages}
        readingDirection={episode.readingDirection}
      >
        <EpisodeAccessGate
          acceptsPayments={acceptsPayments}
          appStoreUrl={appStoreUrl}
          episodeId={episode.id}
          episodePublicId={episode.publicId}
          googlePlayUrl={googlePlayUrl}
          locale={locale}
          nextFreeEpisode={nextFreeEpisode}
          purchaseSurface={episode.purchaseSurface}
          seriesPublicId={series.publicId}
          signedIn={false}
          tenantId={tenantId}
          timeZone={timeZone}
          waitFree={toWaitFreeOffer({
            episodeId: episode.id,
            rule: waitFree,
            ticketState: undefined,
          })}
        />
      </EpisodeGateFrame>
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
        <SectionError>
          <SectionErrorHeading>
            <SectionErrorTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="host.episode.body_error" />
              </Suspense>
            </SectionErrorTitle>
            <SectionErrorDescription>{viewer.message}</SectionErrorDescription>
          </SectionErrorHeading>
        </SectionError>
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
        commentMode={commentMode}
        commentToken={commentToken}
        episode={episode}
        images={viewer.value.images}
        nextEpisode={nextEpisode}
        previousEpisode={previousEpisode}
        series={series}
      />
    );
  }

  // Asked only where a ticket could open the episode: the rule says on its
  // own that it keeps one off the latest episodes, whoever the reader is.
  const ticketState = waitFreeEpisodeEligible(waitFree, episode.id)
    ? await getMyWaitFreeTicketState(tenantId, series.id, sessionId, locale)
    : undefined;

  return (
    <EpisodeGateFrame
      previewImages={previewImages}
      readingDirection={episode.readingDirection}
    >
      <EpisodeAccessGate
        acceptsPayments={acceptsPayments}
        appStoreUrl={appStoreUrl}
        episodeId={episode.id}
        episodePublicId={episode.publicId}
        googlePlayUrl={googlePlayUrl}
        locale={locale}
        nextFreeEpisode={nextFreeEpisode}
        purchaseSurface={episode.purchaseSurface}
        seriesPublicId={series.publicId}
        signedIn
        tenantId={tenantId}
        timeZone={timeZone}
        waitFree={toWaitFreeOffer({
          episodeId: episode.id,
          rule: waitFree,
          ticketState,
        })}
      />
    </EpisodeGateFrame>
  );
};
