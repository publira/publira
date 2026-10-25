import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { deleteSubscriptionPlanAction } from "../_lib/actions";

interface SubscriptionPlanDeleteButtonProps {
  id: string;
  /** The plan's name, which the dialog names it by. */
  name: string;
  tenantId: string;
}

/**
 * Removes one plan, once the operator has confirmed it. Success needs no
 * message — the row it was attached to is gone. A plan anyone has subscribed
 * to is refused by the API, and the message beside the button says to
 * unpublish it instead.
 */
export const SubscriptionPlanDeleteButton = ({
  id,
  name,
  tenantId,
}: SubscriptionPlanDeleteButtonProps) => {
  const formId = `delete-subscription-plan-${id}`;

  return (
    <ActionForm.Root
      action={deleteSubscriptionPlanAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="subscription_plan_id" type="hidden" value={id} />
      <ActionForm.Fieldset className="grid">
        <ConfirmDialog.Root>
          <ConfirmDialog.Trigger
            render={<Button size="sm" type="button" variant="destructive" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionForm.Idle>
                <Message message="admin.subscription_plans.delete_action" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.subscription_plans.deleting" />
              </ActionForm.Pending>
            </Suspense>
          </ConfirmDialog.Trigger>
          <ConfirmDialog.Content>
            <ConfirmDialog.Header>
              <ConfirmDialog.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message="admin.subscription_plans.delete_confirm_title" />
                </Suspense>
              </ConfirmDialog.Title>
              <ConfirmDialog.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message
                    message="admin.subscription_plans.delete_confirm_description"
                    values={{ name }}
                  />
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
                  <Message message="admin.subscription_plans.delete_confirm_action" />
                </Suspense>
              </ConfirmDialog.Action>
            </ConfirmDialog.Footer>
          </ConfirmDialog.Content>
        </ConfirmDialog.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  );
};
