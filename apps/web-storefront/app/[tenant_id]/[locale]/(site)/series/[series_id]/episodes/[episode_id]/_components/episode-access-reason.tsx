import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { resolveAccessToken } from "#lib/api-client";
import { getEpisodeViewer } from "#lib/catalog";
import type { EpisodeAccessState } from "#lib/catalog";
import { getLocale } from "#lib/locale";

/**
 * Says beside the price that the body is open because the reader is credited
 * on it or holds a staff role, which `entitled` alone does not tell apart from
 * a purchase. A purchase and a ticket are what a reader expects to open a paid
 * episode, so they get no line. It shares the body's private read and cache
 * entry, so a failure is the body's to report.
 */
export const EpisodeAccessReason = async ({
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
  if (!viewer.ok) {
    return null;
  }

  if (viewer.value?.entitlementSource === "creator") {
    return (
      <span>
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <Message message="storefront.episode.creator_access" />
        </Suspense>
      </span>
    );
  }
  // Staff open an episode to check it, so the line also says what a reader it
  // is sold to sees in place of the pages.
  if (viewer.value?.entitlementSource === "staff") {
    return (
      <span>
        <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
          <Message message="storefront.episode.staff_access" />
        </Suspense>
      </span>
    );
  }
  return null;
};
