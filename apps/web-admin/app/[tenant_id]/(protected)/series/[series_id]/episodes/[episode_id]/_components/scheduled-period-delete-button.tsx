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
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { AdminMessageKey } from "#components/message";
import { SettledToast } from "#components/settled-toast";

interface ScheduledPeriodDeleteButtonProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
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
    <ActionForm
      action={action}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name={fieldName} type="hidden" value={periodId} />
      <SettledToast />
      <ActionFormFieldset className="grid">
        <ConfirmDialog>
          <ConfirmDialogTrigger
            render={<Button size="sm" type="button" variant="outline" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionFormIdle>
                <Message message={messages.delete} />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message={messages.deleting} />
              </ActionFormPending>
            </Suspense>
          </ConfirmDialogTrigger>
          <ConfirmDialogContent>
            <ConfirmDialogHeader>
              <ConfirmDialogTitle>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message={messages.confirmTitle} />
                </Suspense>
              </ConfirmDialogTitle>
              <ConfirmDialogDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message={messages.confirmDescription} />
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
                  <Message message={messages.confirmAction} />
                </Suspense>
              </ConfirmDialogAction>
            </ConfirmDialogFooter>
          </ConfirmDialogContent>
        </ConfirmDialog>
      </ActionFormFieldset>
    </ActionForm>
  );
};
