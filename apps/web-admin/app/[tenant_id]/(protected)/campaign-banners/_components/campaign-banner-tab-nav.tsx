import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

import { Message } from "#components/message";

interface CampaignBannerTabNavProps {
  current: "basic" | "eye-catch";
  campaignBannerId: string;
}

export const CampaignBannerTabNav = ({
  current,
  campaignBannerId,
}: CampaignBannerTabNavProps) => (
  <div className="flex flex-wrap gap-2">
    <LinkButton
      render={<Link href={`/campaign-banners/${campaignBannerId}`} />}
      variant={current === "basic" ? "default" : "outline"}
    >
      <Message message="admin.campaign_banners.basic_tab" />
    </LinkButton>
    <LinkButton
      render={
        <Link href={`/campaign-banners/${campaignBannerId}?tab=eye-catch`} />
      }
      variant={current === "eye-catch" ? "default" : "outline"}
    >
      <Message message="admin.campaign_banners.image_tab" />
    </LinkButton>
  </div>
);
