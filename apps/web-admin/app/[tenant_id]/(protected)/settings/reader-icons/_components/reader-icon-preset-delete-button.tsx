import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
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
    <ActionForm
      action={deleteReaderIconPresetAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="preset_id" type="hidden" value={presetId} />
      <ActionFormFieldset className="grid">
        <ConfirmDialog>
          <ConfirmDialogTrigger
            render={<Button size="sm" type="button" variant="destructive" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionFormIdle>
                <Message message="admin.settings.reader_icons.presets.delete" />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message="admin.settings.reader_icons.presets.deleting" />
              </ActionFormPending>
            </Suspense>
          </ConfirmDialogTrigger>
          <ConfirmDialogContent>
            <ConfirmDialogHeader>
              <ConfirmDialogTitle>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message
                    message="admin.settings.reader_icons.presets.delete_confirm_title"
                    values={{ position }}
                  />
                </Suspense>
              </ConfirmDialogTitle>
              <ConfirmDialogDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message="admin.settings.reader_icons.presets.delete_confirm_description" />
                </Suspense>
              </ConfirmDialogDescription>
            </ConfirmDialogHeader>
            <ConfirmDialogFooter>
              <ConfirmDialogCancel>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.common.cancel" />
                </Suspense>
              </ConfirmDialogCancel>
              <ConfirmDialogAction form={formId}>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.settings.reader_icons.presets.delete_confirm_action" />
                </Suspense>
              </ConfirmDialogAction>
            </ConfirmDialogFooter>
          </ConfirmDialogContent>
        </ConfirmDialog>
      </ActionFormFieldset>
    </ActionForm>
  );
};
