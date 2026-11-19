import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { deleteReaderIconPresetAction } from "../_lib/actions";

interface ReaderIconPresetDeleteButtonProps {
  /** Where the preset sits in the gallery, which is how the dialog names it. */
  position: number;
  presetId: string;
  tenantId: string;
}

/**
 * Removes one preset once staff confirm it. The API does not say how many
 * readers picked it, so the confirmation always warns that whoever did is left
 * without an icon. Success needs no message — the tile it was attached to is
 * gone.
 */
export const ReaderIconPresetDeleteButton = ({
  position,
  presetId,
  tenantId,
}: ReaderIconPresetDeleteButtonProps) => {
  const formId = `delete-reader-icon-preset-${presetId}`;

  return (
    <ActionForm.Root
      action={deleteReaderIconPresetAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="preset_id" type="hidden" value={presetId} />
      <ActionForm.Fieldset className="grid">
        <ConfirmDialog.Root>
          <ConfirmDialog.Trigger
            render={<Button size="sm" type="button" variant="destructive" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.reader_icons.presets.delete" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.settings.reader_icons.presets.deleting" />
              </ActionForm.Pending>
            </Suspense>
          </ConfirmDialog.Trigger>
          <ConfirmDialog.Content>
            <ConfirmDialog.Header>
              <ConfirmDialog.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message
                    message="admin.settings.reader_icons.presets.delete_confirm_title"
                    values={{ position }}
                  />
                </Suspense>
              </ConfirmDialog.Title>
              <ConfirmDialog.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message="admin.settings.reader_icons.presets.delete_confirm_description" />
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
                  <Message message="admin.settings.reader_icons.presets.delete_confirm_action" />
                </Suspense>
              </ConfirmDialog.Action>
            </ConfirmDialog.Footer>
          </ConfirmDialog.Content>
        </ConfirmDialog.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  );
};
