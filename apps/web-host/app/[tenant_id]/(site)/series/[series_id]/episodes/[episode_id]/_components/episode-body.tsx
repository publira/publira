import { SectionError } from "@publira/ui-components/section-error";
import { notFound } from "next/navigation";

import { resolveAccessToken } from "#lib/api-client";
import type { EpisodeAccessState, EpisodeImageItem } from "#lib/catalog";
import { getEpisodeViewer, isPublicEpisodeBody } from "#lib/catalog";

import { EpisodeAccessGate } from "./episode-access-gate";
import { EpisodeBodyNotice } from "./episode-body-notice";
import { EpisodeViewer } from "./episode-viewer";

export const EpisodeBody = async ({
  acceptsPayments,
  access,
  checkoutSessionId,
  episodePublicId,
  episodeTitle,
  images,
  seriesPublicId,
  tenantId,
}: {
  acceptsPayments: boolean;
  access: EpisodeAccessState;
  checkoutSessionId: string;
  episodePublicId: string;
  episodeTitle: string;
  images: EpisodeImageItem[];
  seriesPublicId: string;
  tenantId: string;
}) => {
  if (isPublicEpisodeBody(access)) {
    return <EpisodeViewer episodeTitle={episodeTitle} images={images} />;
  }

  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return (
      <EpisodeBodyNotice>
        <EpisodeAccessGate
          acceptsPayments={acceptsPayments}
          episodePublicId={episodePublicId}
          seriesPublicId={seriesPublicId}
          signedIn={false}
          tenantId={tenantId}
        />
      </EpisodeBodyNotice>
    );
  }

  const viewer = await getEpisodeViewer(
    tenantId,
    seriesPublicId,
    episodePublicId,
    sessionId,
    checkoutSessionId
  );
  if (!viewer.ok) {
    return (
      <EpisodeBodyNotice>
        <SectionError
          description={viewer.message}
          title="本文を表示できませんでした"
        />
      </EpisodeBodyNotice>
    );
  }
  if (!viewer.value) {
    notFound();
  }
  if (viewer.value.access === "entitled") {
    return (
      <EpisodeViewer episodeTitle={episodeTitle} images={viewer.value.images} />
    );
  }

  return (
    <EpisodeBodyNotice>
      <EpisodeAccessGate
        acceptsPayments={acceptsPayments}
        episodePublicId={episodePublicId}
        seriesPublicId={seriesPublicId}
        signedIn
        tenantId={tenantId}
      />
    </EpisodeBodyNotice>
  );
};
