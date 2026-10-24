import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { resolveAccessToken } from "#lib/api-client";
import { getEpisodeViewer } from "#lib/catalog";
import type {
  EpisodeAccessState,
  EpisodeEntitlementSourceState,
} from "#lib/catalog";
import { getLocale } from "#lib/locale";
import type { StorefrontMessageKey } from "#lib/messages";

/**
 * The line beside the price for each grant that opens the body because of who
 * the reader is, with the skeleton that stands in for it. A purchase and a
 * ticket are what a reader expects to open a paid episode, so they get none.
 */
const reasons: Partial<
  Record<
    EpisodeEntitlementSourceState,
    { message: StorefrontMessageKey; skeletonClassName: string }
  >
> = {
  creator: {
    message: "storefront.episode.creator_access",
    skeletonClassName: "h-4 w-40",
  },
  // Staff open an episode to check it, so the line also says what a reader it
  // is sold to sees in place of the pages.
  staff: {
    message: "storefront.episode.staff_access",
    skeletonClassName: "h-4 w-80",
  },
};

/**
 * Says beside the price that the body is open because the reader is credited
 * on it or holds a staff role, which `entitled` alone does not tell apart from
 * a purchase. It shares the body's private read and cache entry, so a failure
 * is the body's to report.
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
  const source = viewer.ok ? viewer.value?.entitlementSource : undefined;
  const reason = source ? reasons[source] : undefined;
  if (!reason) {
    return null;
  }

  return (
    <span>
      <Suspense
        fallback={<SkeletonLine className={reason.skeletonClassName} />}
      >
        <Message message={reason.message} />
      </Suspense>
    </span>
  );
};
