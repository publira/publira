import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";

import { closeRoyaltyStatementAction } from "../_lib/actions";

interface CloseStatementButtonProps {
  /**
   * The confirmation's `ConfirmDialog.Title`, naming the month, and its
   * `ConfirmDialog.Description`, stating the total payout the close fixes.
   */
  children: ReactNode;
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
  children,
  period,
  tenantId,
}: CloseStatementButtonProps) => {
  const formId = `close-royalty-statement-${period}`;

  return (
    <ActionForm.Root
      action={closeRoyaltyStatementAction}
      className="grid justify-items-start gap-2"
      id={formId}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="period" type="hidden" value={period} />
      <ActionForm.Fieldset>
        <ConfirmDialog.Root>
          <ConfirmDialog.Trigger render={<Button type="button" />}>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <ActionForm.Idle>
                <Message message="admin.royalties.close.button" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.royalties.close.closing" />
              </ActionForm.Pending>
            </Suspense>
          </ConfirmDialog.Trigger>
          <ConfirmDialog.Content>
            <ConfirmDialog.Header>{children}</ConfirmDialog.Header>
            <ConfirmDialog.Footer>
              <ConfirmDialog.Cancel>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.common.cancel" />
                </Suspense>
              </ConfirmDialog.Cancel>
              <ConfirmDialog.Action form={formId}>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.royalties.close.confirm_action" />
                </Suspense>
              </ConfirmDialog.Action>
            </ConfirmDialog.Footer>
          </ConfirmDialog.Content>
        </ConfirmDialog.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  );
};
