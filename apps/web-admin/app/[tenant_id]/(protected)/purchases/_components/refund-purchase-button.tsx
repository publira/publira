import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatPrice } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SettledToast } from "#components/settled-toast";

import { refundPurchaseAction } from "../_lib/actions";
import * as RefundDraft from "./refund-draft";
import type { RefundAmountBounds } from "./refund-draft";

interface RefundPurchaseButtonProps {
  /**
   * What can be refunded, for a purchase a refund in part is possible on.
   * `null` refunds all that is left and asks for no amount: a pack of coins is
   * only ever refunded in full, and an amount in no currency is no amount.
   */
  bounds: RefundAmountBounds | null;
  locale: Locale;
  purchaseId: string;
  tenantId: string;
}

/**
 * Refunds the purchase once staff confirm it with a reason, and, where a
 * refund in part is possible, the amount to give back, which starts at all
 * that is left.
 *
 * The form wraps the dialog rather than sitting in its popup, and the fields
 * join it through `form=`, so confirming submits a form that is still mounted
 * while the popup is being torn down. A refund the API refused is reported
 * under the button; one it made re-renders the drawer around the refunded
 * purchase, so success is a toast.
 */
export const RefundPurchaseButton = ({
  bounds,
  locale,
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
      {bounds ? (
        <>
          <input name="currency" type="hidden" value={bounds.currency} />
          <input name="left" type="hidden" value={bounds.left} />
        </>
      ) : null}
      <SettledToast />
      <ActionForm.Fieldset className="grid justify-start">
        {/* A refund the drawer re-renders around starts the dialog over, at
            what is left of the purchase as it stands now, while the toast
            above it stays to report the refund. */}
        <RefundDraft.Root
          bounds={bounds}
          key={bounds ? `${bounds.left}-${bounds.requested}` : "whole"}
        >
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
                        {bounds ? (
                          <Message message="admin.purchases.refund_confirm_description_amount" />
                        ) : (
                          <Message message="admin.purchases.refund_confirm_description" />
                        )}
                      </Suspense>
                    </Dialog.Description>
                  </Dialog.Header>

                  {bounds ? (
                    <Field.Root className="mt-4">
                      <Field.Label required>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-16" />}
                        >
                          <Message message="admin.purchases.refund_amount" />
                        </Suspense>
                      </Field.Label>
                      <Field.Content>
                        <RefundDraft.AmountInput formId={formId} />
                      </Field.Content>
                      <Field.Description>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-56" />}
                        >
                          {bounds.requested > 0 ? (
                            <Message
                              message="admin.purchases.refund_amount_waiting_description"
                              values={{
                                amount: formatPrice(bounds.requested, {
                                  currency: bounds.currency,
                                  locale,
                                }),
                              }}
                            />
                          ) : (
                            <Message
                              message="admin.purchases.refund_amount_description"
                              values={{
                                amount: formatPrice(bounds.left, {
                                  currency: bounds.currency,
                                  locale,
                                }),
                              }}
                            />
                          )}
                        </Suspense>{" "}
                        <RefundDraft.AmountNote />
                      </Field.Description>
                    </Field.Root>
                  ) : null}

                  <Field.Root className="mt-4">
                    <Field.Label required>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="admin.purchases.reason" />
                      </Suspense>
                    </Field.Label>
                    <Field.Content>
                      <RefundDraft.Textarea formId={formId} />
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
                    <RefundDraft.ConfirmButton formId={formId}>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="admin.purchases.refund_confirm_action" />
                      </Suspense>
                    </RefundDraft.ConfirmButton>
                  </Dialog.Footer>
                </Dialog.Popup>
              </Dialog.Viewport>
            </Dialog.Portal>
          </Dialog.Root>
        </RefundDraft.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  );
};
