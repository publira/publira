"use client";

import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from "@publira/ui-components/dialog";

import { useClientMessages } from "#components/client-message";
import { SettledToast } from "#components/settled-toast";
import { useTenantId } from "#lib/use-tenant-id";

interface EpisodeImageDeleteButtonProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
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
    <ActionForm
      action={action}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="episode_id" type="hidden" value={episodeId} />
      <input name="image_id" type="hidden" value={imageId} />
      <SettledToast />
      <ActionFormFieldset className="grid">
        <ConfirmDialog>
          <ConfirmDialogTrigger
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
            <ActionFormIdle>
              {t("admin.series.episodes.image_delete.action")}
            </ActionFormIdle>
            <ActionFormPending>
              {t("admin.series.episodes.image_delete.pending")}
            </ActionFormPending>
          </ConfirmDialogTrigger>
          <ConfirmDialogContent>
            <ConfirmDialogHeader>
              <ConfirmDialogTitle>
                {t("admin.series.episodes.image_delete.confirm_title", {
                  position: String(position),
                })}
              </ConfirmDialogTitle>
              <ConfirmDialogDescription>
                {t("admin.series.episodes.image_delete.confirm_description")}
              </ConfirmDialogDescription>
            </ConfirmDialogHeader>
            <ConfirmDialogFooter>
              <ConfirmDialogCancel>
                {t("admin.common.cancel")}
              </ConfirmDialogCancel>
              <ConfirmDialogAction form={formId}>
                {t("admin.series.episodes.image_delete.confirm_action")}
              </ConfirmDialogAction>
            </ConfirmDialogFooter>
          </ConfirmDialogContent>
        </ConfirmDialog>
      </ActionFormFieldset>
    </ActionForm>
  );
};
