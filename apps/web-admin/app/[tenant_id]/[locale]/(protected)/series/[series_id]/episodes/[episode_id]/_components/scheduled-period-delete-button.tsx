import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { AdminMessageKey } from "#components/message";
import { SettledToast } from "#components/settled-toast";

interface ScheduledPeriodDeleteButtonProps {
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  /** The form field the Action reads the period's ID from. */
  fieldName: string;
  /** The wording of one kind of period: a free reading period's, or a campaign's. */
  messages: {
    confirmAction: AdminMessageKey;
    confirmDescription: AdminMessageKey;
    confirmTitle: AdminMessageKey;
    delete: AdminMessageKey;
    deleting: AdminMessageKey;
  };
  periodId: string;
  tenantId: string;
}

/**
 * Deletes one scheduled period of an episode once staff confirm it. The row
 * leaves the list with the button in it, so success is a toast.
 */
export const ScheduledPeriodDeleteButton = ({
  action,
  fieldName,
  messages,
  periodId,
  tenantId,
}: ScheduledPeriodDeleteButtonProps) => {
  const formId = `delete-period-${periodId}`;

  return (
    <ActionForm.Root
      action={action}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name={fieldName} type="hidden" value={periodId} />
      <SettledToast />
      <ActionForm.Fieldset className="grid">
        <ConfirmDialog.Root>
          <ConfirmDialog.Trigger
            render={<Button size="sm" type="button" variant="outline" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionForm.Idle>
                <Message message={messages.delete} />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message={messages.deleting} />
              </ActionForm.Pending>
            </Suspense>
          </ConfirmDialog.Trigger>
          <ConfirmDialog.Content>
            <ConfirmDialog.Header>
              <ConfirmDialog.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message={messages.confirmTitle} />
                </Suspense>
              </ConfirmDialog.Title>
              <ConfirmDialog.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message={messages.confirmDescription} />
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
                  <Message message={messages.confirmAction} />
                </Suspense>
              </ConfirmDialog.Action>
            </ConfirmDialog.Footer>
          </ConfirmDialog.Content>
        </ConfirmDialog.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  );
};
