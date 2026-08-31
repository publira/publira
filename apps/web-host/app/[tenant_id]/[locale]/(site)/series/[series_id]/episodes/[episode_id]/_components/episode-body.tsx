import { getMessage } from "@publira/i18n";
import { SectionError } from "@publira/ui-components/section-error";
import { notFound } from "next/navigation";

import { resolveAccessToken } from "#lib/api-client";
import type {
  EpisodeAccessState,
  EpisodeDetail,
  EpisodeImageItem,
} from "#lib/catalog";
import { getEpisodeViewer, isPublicEpisodeBody } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";

import { EpisodeAccessGate } from "./episode-access-gate";
import { EpisodeBodyNotice } from "./episode-body-notice";
import { EpisodeViewer } from "./episode-viewer";

export const EpisodeBody = async ({
  acceptsPayments,
  access,
  checkoutSessionId,
  episode,
  images,
  seriesPublicId,
  tenantId,
}: {
  acceptsPayments: boolean;
  access: EpisodeAccessState;
  checkoutSessionId: string;
  episode: EpisodeDetail;
  images: EpisodeImageItem[];
  seriesPublicId: string;
  tenantId: string;
}) => {
  if (isPublicEpisodeBody(access)) {
    return <EpisodeViewer episode={episode} images={images} />;
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
    episode.publicId,
    sessionId,
    locale,
    checkoutSessionId
  );
  if (!viewer.ok) {
    const messages = await loadHostMessages(locale);
    return (
      <EpisodeBodyNotice>
        <SectionError
          description={viewer.message}
          title={getMessage(messages, "host.episode.body_error")}
        />
      </EpisodeBodyNotice>
    );
  }
  if (!viewer.value) {
    notFound();
  }
  if (viewer.value.access === "entitled") {
    return <EpisodeViewer episode={episode} images={viewer.value.images} />;
  }

  return (
    <EpisodeBodyNotice>
      <EpisodeAccessGate
        acceptsPayments={acceptsPayments}
        episodePublicId={episode.publicId}
        seriesPublicId={seriesPublicId}
        signedIn
        tenantId={tenantId}
      />
    </EpisodeBodyNotice>
  );
};
