import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { EyeCatchFormField } from "#components/eye-catch/form-field";
import { Message } from "#components/message";

import { updateCampaignBannerImageAction } from "../_lib/actions";
import type { CampaignBannerListItem } from "../campaign-banner-types";

interface CampaignBannerImageFormProps {
  banner: CampaignBannerListItem;
  tenantId: string;
}

/**
 * Replaces the banner's whole image through the shared cover image field.
 * There is no removing it: the API keeps a banner's image until another
 * replaces it, so the field offers no delete. `UpdateCampaignBanner` takes the
 * link, the alternative text, the window, and the published flag alongside,
 * so the form posts back the ones it read.
 */
export const CampaignBannerImageForm = ({
  banner,
  tenantId,
}: CampaignBannerImageFormProps) => (
  <ActionForm.Root
    action={updateCampaignBannerImageAction}
    className="grid gap-4"
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="campaign_banner_id" type="hidden" value={banner.id} />
    <input name="link_url" type="hidden" value={banner.linkUrl} />
    <input name="alt_text" type="hidden" value={banner.altText} />
    <input name="starts_at" type="hidden" value={banner.startsAt} />
    <input name="ends_at" type="hidden" value={banner.endsAt} />
    {banner.published ? (
      <input name="published" type="hidden" value="on" />
    ) : null}
    {/* A save refreshes the page with the image it stored, and the new
        timestamp remounts the field so the picked file does not outlive the
        save it was sent with. */}
    <EyeCatchFormField
      clearable={false}
      eyeCatchImageUpdatedAt={banner.imageUpdatedAt}
      key={banner.imageUpdatedAt}
      variants={banner.imageVariants}
    />
    <div className="flex justify-end">
      <ActionForm.Submit>
        <ActionForm.Idle>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="admin.campaign_banners.form.image_update" />
          </Suspense>
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.campaign_banners.form.submitting" />
          </Suspense>
        </ActionForm.Pending>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);
