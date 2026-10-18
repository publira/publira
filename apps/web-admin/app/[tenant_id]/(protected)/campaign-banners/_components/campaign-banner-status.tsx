import { StatusChip } from "@publira/ui-components/badge";
import type { BadgeTone } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { CampaignBannerStatus } from "#lib/campaign-banner-schedule";

const STATUS_TONES: Record<CampaignBannerStatus, BadgeTone> = {
  ended: "muted",
  scheduled: "info",
  showing: "success",
  unpublished: "warning",
};

/**
 * The name a standing goes by. Each branch names its key inside the
 * `<Message>` it returns, so the key is where a translation extractor sees it.
 */
const CampaignBannerStatusMessage = ({
  status,
}: {
  status: CampaignBannerStatus;
}) => {
  switch (status) {
    case "showing": {
      return <Message message="admin.campaign_banners.status.showing" />;
    }
    case "scheduled": {
      return <Message message="admin.campaign_banners.status.scheduled" />;
    }
    case "ended": {
      return <Message message="admin.campaign_banners.status.ended" />;
    }
    default: {
      return <Message message="admin.campaign_banners.status.unpublished" />;
    }
  }
};

/** Whether a reader of the site sees the banner now, and if not, why not. */
export const CampaignBannerStatusChip = ({
  status,
}: {
  status: CampaignBannerStatus;
}) => (
  <StatusChip status={STATUS_TONES[status]}>
    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
      <CampaignBannerStatusMessage status={status} />
    </Suspense>
  </StatusChip>
);
