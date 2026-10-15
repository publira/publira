import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "@publira/ui-components/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
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
    <ActionForm
      action={refundPurchaseAction}
      className="grid gap-2"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="purchase_id" type="hidden" value={purchaseId} />
      <SettledToast />
      <ActionFormFieldset className="grid justify-start">
        <RefundReason>
          <Dialog>
            <DialogTrigger
              render={<Button type="button" variant="destructive" />}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <ActionFormIdle>
                  <Message message="admin.purchases.refund" />
                </ActionFormIdle>
                <ActionFormPending>
                  <Message message="admin.purchases.refunding" />
                </ActionFormPending>
              </Suspense>
            </DialogTrigger>
            <DialogPortal>
              <DialogBackdrop className="z-50" />
              <DialogViewport>
                <DialogPopup className="z-60">
                  <DialogHeader>
                    <DialogTitle className="text-lg font-semibold">
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-48" />}
                      >
                        <Message message="admin.purchases.refund_confirm_title" />
                      </Suspense>
                    </DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground">
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-72" />}
                      >
                        <Message message="admin.purchases.refund_confirm_description" />
                      </Suspense>
                    </DialogDescription>
                  </DialogHeader>

                  <Field className="mt-4">
                    <FieldLabel required>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="admin.purchases.reason" />
                      </Suspense>
                    </FieldLabel>
                    <FieldContent>
                      <RefundReasonTextarea formId={formId} />
                    </FieldContent>
                    <FieldDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-56" />}
                      >
                        <Message message="admin.purchases.reason_description" />
                      </Suspense>
                    </FieldDescription>
                  </Field>

                  <DialogFooter>
                    <DialogClose
                      render={<Button type="button" variant="outline" />}
                    >
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="admin.common.cancel" />
                      </Suspense>
                    </DialogClose>
                    <RefundConfirmButton formId={formId}>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="admin.purchases.refund_confirm_action" />
                      </Suspense>
                    </RefundConfirmButton>
                  </DialogFooter>
                </DialogPopup>
              </DialogViewport>
            </DialogPortal>
          </Dialog>
        </RefundReason>
      </ActionFormFieldset>
    </ActionForm>
  );
};
