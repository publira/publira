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
} from "#lib/catalog";
import { getEpisodeViewer, isPublicEpisodeBody } from "#lib/catalog";
import { getLocale } from "#lib/locale";

import { EpisodeAccessGate } from "./episode-access-gate";
import { EpisodeBodyNotice } from "./episode-body-notice";
import { EpisodeViewer } from "./episode-viewer";

export const EpisodeBody = async ({
  acceptsPayments,
  access,
  checkoutSessionId,
  commentMode,
  commentToken,
  episode,
  images,
  nextEpisode,
  previousEpisode,
  series,
  tenantId,
}: {
  acceptsPayments: boolean;
  access: EpisodeAccessState;
  checkoutSessionId: string;
  /** Passed to the viewer, which ends the episode on the comment section. */
  commentMode: SeriesCommentMode;
  /** Cursor of the comment page the URL asks for. Empty on the newest page. */
  commentToken: string;
  episode: EpisodeDetail;
  images: EpisodeImageItem[];
  /** Absent at the ends of the series; the viewer's own chrome links to them. */
  nextEpisode?: EpisodeNeighborItem;
  previousEpisode?: EpisodeNeighborItem;
  series: EpisodeSeriesSummary;
  tenantId: string;
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
      <EpisodeBodyNotice>
        <EpisodeAccessGate
          acceptsPayments={acceptsPayments}
          episodePublicId={episode.publicId}
          seriesPublicId={series.publicId}
          signedIn={false}
          tenantId={tenantId}
        />
      </EpisodeBodyNotice>
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
  if (viewer.value.access === "entitled") {
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

  return (
    <EpisodeBodyNotice>
      <EpisodeAccessGate
        acceptsPayments={acceptsPayments}
        episodePublicId={episode.publicId}
        seriesPublicId={series.publicId}
        signedIn
        tenantId={tenantId}
      />
    </EpisodeBodyNotice>
  );
};
