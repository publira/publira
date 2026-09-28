import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { resolveAccessToken } from "#lib/api-client";
import { getEpisodeViewer } from "#lib/catalog";
import type { EpisodeAccessState } from "#lib/catalog";
import { getLocale } from "#lib/locale";

/**
 * Says beside the price that the body is open because the reader is credited on
 * it, which `entitled` alone does not tell apart from a purchase. It shares the
 * body's private read and cache entry, so a failure is the body's to report.
 */
export const EpisodeCreatorAccess = async ({
  access,
  checkoutSessionId,
  episodePublicId,
  seriesPublicId,
  tenantId,
}: {
  /** The anonymous read's answer; a body free to everyone needs no reason. */
  access: EpisodeAccessState;
  checkoutSessionId: string;
  episodePublicId: string;
  seriesPublicId: string;
  tenantId: string;
}) => {
  if (access === "free") {
    return null;
  }

  const [locale, sessionId] = await Promise.all([
    getLocale(),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return null;
  }

  const viewer = await getEpisodeViewer(
    tenantId,
    seriesPublicId,
    episodePublicId,
    sessionId,
    locale,
    checkoutSessionId
  );
  if (!viewer.ok || viewer.value?.entitlementSource !== "creator") {
    return null;
  }

  return (
    <span>
      <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
        <Message message="host.episode.creator_access" />
      </Suspense>
    </span>
  );
};
