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
import type { ReactNode } from "react";

import { Message } from "#components/message";

import { closeRoyaltyStatementAction } from "../_lib/actions";

interface CloseStatementButtonProps {
  /** States the total payout the close fixes, already worded for the reader. */
  confirmDescription: ReactNode;
  /** Names the month, already worded for the reader. */
  confirmTitle: ReactNode;
  period: string;
  tenantId: string;
}

/**
 * Closes one month after the operator has confirmed its period and payout. The
 * button stays disabled while the close is in flight, and a successful close
 * leaves this screen for the statement, so the same month is never sent twice
 * from here; a second close from elsewhere is refused by the API.
 */
export const CloseStatementButton = ({
  confirmDescription,
  confirmTitle,
  period,
  tenantId,
}: CloseStatementButtonProps) => {
  const formId = `close-royalty-statement-${period}`;

  return (
    <ActionForm
      action={closeRoyaltyStatementAction}
      className="grid justify-items-start gap-2"
      id={formId}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="period" type="hidden" value={period} />
      <ActionFormFieldset>
        <ConfirmDialog>
          <ConfirmDialogTrigger render={<Button type="button" />}>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <ActionFormIdle>
                <Message message="admin.royalties.close.button" />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message="admin.royalties.close.closing" />
              </ActionFormPending>
            </Suspense>
          </ConfirmDialogTrigger>
          <ConfirmDialogContent>
            <ConfirmDialogHeader>
              <ConfirmDialogTitle>{confirmTitle}</ConfirmDialogTitle>
              <ConfirmDialogDescription>
                {confirmDescription}
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
                  <Message message="admin.royalties.close.confirm_action" />
                </Suspense>
              </ConfirmDialogAction>
            </ConfirmDialogFooter>
          </ConfirmDialogContent>
        </ConfirmDialog>
      </ActionFormFieldset>
    </ActionForm>
  );
};
