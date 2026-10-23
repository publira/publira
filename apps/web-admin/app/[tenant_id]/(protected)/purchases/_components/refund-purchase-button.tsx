import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SettledToast } from "#components/settled-toast";

import { refundPurchaseAction } from "../_lib/actions";
import {
  RefundConfirmButton,
  RefundReason,
  RefundReasonTextarea,
} from "./refund-reason";

interface RefundPurchaseButtonProps {
  purchaseId: string;
  tenantId: string;
}

/**
 * Refunds the purchase once staff confirm it with a reason.
 *
 * The form wraps the dialog rather than sitting in its popup, and the reason
 * field joins it through `form=`, so confirming submits a form that is still
 * mounted while the popup is being torn down. A refund the API refused is
 * reported under the button; one it made re-renders the drawer around the
 * refunded purchase, which has no button any more, so success is a toast.
 */
export const RefundPurchaseButton = ({
  purchaseId,
  tenantId,
}: RefundPurchaseButtonProps) => {
  const formId = `refund-purchase-${purchaseId}`;

  return (
    <ActionForm.Root
      action={refundPurchaseAction}
      className="grid gap-2"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="purchase_id" type="hidden" value={purchaseId} />
      <SettledToast />
      <ActionForm.Fieldset className="grid justify-start">
        <RefundReason>
          <Dialog.Root>
            <Dialog.Trigger
              render={<Button type="button" variant="destructive" />}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <ActionForm.Idle>
                  <Message message="admin.purchases.refund" />
                </ActionForm.Idle>
                <ActionForm.Pending>
                  <Message message="admin.purchases.refunding" />
                </ActionForm.Pending>
              </Suspense>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Backdrop className="z-50" />
              <Dialog.Viewport>
                <Dialog.Popup className="z-60">
                  <Dialog.Header>
                    <Dialog.Title className="text-lg font-semibold">
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-48" />}
                      >
                        <Message message="admin.purchases.refund_confirm_title" />
                      </Suspense>
                    </Dialog.Title>
                    <Dialog.Description className="text-sm text-muted-foreground">
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-72" />}
                      >
                        <Message message="admin.purchases.refund_confirm_description" />
                      </Suspense>
                    </Dialog.Description>
                  </Dialog.Header>

                  <Field.Root className="mt-4">
                    <Field.Label required>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="admin.purchases.reason" />
                      </Suspense>
                    </Field.Label>
                    <Field.Content>
                      <RefundReasonTextarea formId={formId} />
                    </Field.Content>
                    <Field.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-56" />}
                      >
                        <Message message="admin.purchases.reason_description" />
                      </Suspense>
                    </Field.Description>
                  </Field.Root>

                  <Dialog.Footer>
                    <Dialog.Close
                      render={<Button type="button" variant="outline" />}
                    >
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="admin.common.cancel" />
                      </Suspense>
                    </Dialog.Close>
                    <RefundConfirmButton formId={formId}>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="admin.purchases.refund_confirm_action" />
                      </Suspense>
                    </RefundConfirmButton>
                  </Dialog.Footer>
                </Dialog.Popup>
              </Dialog.Viewport>
            </Dialog.Portal>
          </Dialog.Root>
        </RefundReason>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  );
};
