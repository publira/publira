import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { deleteCampaignBannerAction } from "../_lib/actions";

interface CampaignBannerDeleteButtonProps {
  /** The words drawn into the image, which the dialog names the banner by. */
  altText: string;
  id: string;
  /** Where the banner links, which names a banner nobody has described. */
  linkUrl: string;
  tenantId: string;
}

/**
 * Removes one banner, once the operator has confirmed it. Success needs no
 * message — the row it was attached to is gone.
 */
export const CampaignBannerDeleteButton = ({
  altText,
  id,
  linkUrl,
  tenantId,
}: CampaignBannerDeleteButtonProps) => {
  const formId = `delete-campaign-banner-${id}`;

  return (
    <ActionForm.Root
      action={deleteCampaignBannerAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="campaign_banner_id" type="hidden" value={id} />
      <ActionForm.Fieldset className="grid">
        <ConfirmDialog.Root>
          <ConfirmDialog.Trigger
            render={<Button size="sm" type="button" variant="destructive" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionForm.Idle>
                <Message message="admin.campaign_banners.delete_action" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.campaign_banners.deleting" />
              </ActionForm.Pending>
            </Suspense>
          </ConfirmDialog.Trigger>
          <ConfirmDialog.Content>
            <ConfirmDialog.Header>
              <ConfirmDialog.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message="admin.campaign_banners.delete_confirm_title" />
                </Suspense>
              </ConfirmDialog.Title>
              <ConfirmDialog.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  {altText ? (
                    <Message
                      message="admin.campaign_banners.delete_confirm_description_named"
                      values={{ name: altText }}
                    />
                  ) : (
                    <Message
                      message="admin.campaign_banners.delete_confirm_description"
                      values={{ link: linkUrl }}
                    />
                  )}
                </Suspense>
              </ConfirmDialog.Description>
            </ConfirmDialog.Header>
            <ConfirmDialog.Footer>
              <ConfirmDialog.Cancel>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.common.cancel" />
                </Suspense>
              </ConfirmDialog.Cancel>
              <ConfirmDialog.Action form={formId}>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.campaign_banners.delete_confirm_action" />
                </Suspense>
              </ConfirmDialog.Action>
            </ConfirmDialog.Footer>
          </ConfirmDialog.Content>
        </ConfirmDialog.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  );
};
