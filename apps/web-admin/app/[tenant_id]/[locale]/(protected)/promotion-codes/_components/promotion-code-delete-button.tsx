import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { deletePromotionCodeAction } from "../_lib/actions";

interface PromotionCodeDeleteButtonProps {
  /** The code as the drawer shows it, which the dialog names it by. */
  code: string;
  codeId: string;
  /** The page of the list the drawer was opened from, which deleting returns to. */
  listToken: string;
  tenantId: string;
}

/**
 * Deletes the code once the operator confirms it, which closes the drawer on
 * the list. The dialog says what stays: the purchases the code discounted and
 * its redemptions keep its name.
 *
 * The form wraps the dialog rather than sitting in its popup, and the confirm
 * button joins it through `form=`, so confirming submits a form that is still
 * mounted while the popup is being torn down, and a refusal is said under the
 * button once the dialog has closed. The dialog sits above the
 * drawer, so its layers are raised over the drawer's.
 */
export const PromotionCodeDeleteButton = ({
  code,
  codeId,
  listToken,
  tenantId,
}: PromotionCodeDeleteButtonProps) => {
  const formId = `delete-promotion-code-${codeId}`;

  return (
    <ActionForm.Root
      action={deletePromotionCodeAction}
      className="grid gap-2"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="promotion_code_id" type="hidden" value={codeId} />
      <input name="list_token" type="hidden" value={listToken} />
      <ActionForm.Fieldset className="grid justify-start">
        <Dialog.Root>
          <Dialog.Trigger
            render={<Button type="button" variant="destructive" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionForm.Idle>
                <Message message="admin.promotion_codes.delete" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.promotion_codes.deleting" />
              </ActionForm.Pending>
            </Suspense>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop className="z-50" />
            <Dialog.Viewport>
              <Dialog.Popup className="z-60">
                <Dialog.Header>
                  <Dialog.Title className="text-lg font-semibold">
                    <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                      <Message
                        message="admin.promotion_codes.delete_confirm_title"
                        values={{ code }}
                      />
                    </Suspense>
                  </Dialog.Title>
                  <Dialog.Description className="text-sm text-muted-foreground">
                    <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                      <Message message="admin.promotion_codes.delete_confirm_description" />
                    </Suspense>
                  </Dialog.Description>
                </Dialog.Header>
                <Dialog.Footer>
                  <Dialog.Close
                    render={<Button type="button" variant="outline" />}
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <Message message="admin.common.cancel" />
                    </Suspense>
                  </Dialog.Close>
                  <Dialog.Close
                    form={formId}
                    render={<Button variant="destructive" />}
                    type="submit"
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <Message message="admin.promotion_codes.delete_confirm_action" />
                    </Suspense>
                  </Dialog.Close>
                </Dialog.Footer>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  );
};
