"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";

import { useClientMessages } from "#components/client-message";
import { SettledToast } from "#components/settled-toast";
import { useTenantId } from "#lib/use-tenant-id";

interface EpisodeImageDeleteButtonProps {
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  episodeId: string;
  imageId: string;
  /** The page's 1-based place in the episode, as the grid shows it. */
  position: number;
}

/**
 * Deletes one page once staff confirm it. The page leaves the grid with the
 * button in it, so success is a toast.
 */
export const EpisodeImageDeleteButton = ({
  action,
  episodeId,
  imageId,
  position,
}: EpisodeImageDeleteButtonProps) => {
  const t = useClientMessages();
  const tenantId = useTenantId();
  const formId = `delete-episode-image-${imageId}`;

  return (
    <ActionForm.Root
      action={action}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="episode_id" type="hidden" value={episodeId} />
      <input name="image_id" type="hidden" value={imageId} />
      <SettledToast />
      <ActionForm.Fieldset className="grid">
        <ConfirmDialog.Root>
          <ConfirmDialog.Trigger
            render={
              <Button
                aria-label={t("admin.series.episodes.image_delete.label", {
                  position: String(position),
                })}
                size="sm"
                type="button"
                variant="outline"
              />
            }
          >
            <ActionForm.Idle>
              {t("admin.series.episodes.image_delete.action")}
            </ActionForm.Idle>
            <ActionForm.Pending>
              {t("admin.series.episodes.image_delete.pending")}
            </ActionForm.Pending>
          </ConfirmDialog.Trigger>
          <ConfirmDialog.Content>
            <ConfirmDialog.Header>
              <ConfirmDialog.Title>
                {t("admin.series.episodes.image_delete.confirm_title", {
                  position: String(position),
                })}
              </ConfirmDialog.Title>
              <ConfirmDialog.Description>
                {t("admin.series.episodes.image_delete.confirm_description")}
              </ConfirmDialog.Description>
            </ConfirmDialog.Header>
            <ConfirmDialog.Footer>
              <ConfirmDialog.Cancel>
                {t("admin.common.cancel")}
              </ConfirmDialog.Cancel>
              <ConfirmDialog.Action form={formId}>
                {t("admin.series.episodes.image_delete.confirm_action")}
              </ConfirmDialog.Action>
            </ConfirmDialog.Footer>
          </ConfirmDialog.Content>
        </ConfirmDialog.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  );
};
