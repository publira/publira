import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { retireCoinPackAction } from "../_lib/actions";

interface CoinPackRetireButtonProps {
  coinName: string;
  id: string;
  /** The pack as its row names it, for the dialog to say which one goes. */
  title: string;
  tenantId: string;
}

/**
 * Takes a pack off sale for good, once the administrator has confirmed it.
 * Success needs no message: the row it was attached to is gone.
 */
export const CoinPackRetireButton = ({
  coinName,
  id,
  tenantId,
  title,
}: CoinPackRetireButtonProps) => {
  const formId = `retire-coin-pack-${id}`;

  return (
    <ActionForm.Root
      action={retireCoinPackAction}
      className="grid gap-1"
      id={formId}
      showSuccess={false}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="coin_pack_id" type="hidden" value={id} />
      <ActionForm.Fieldset className="grid">
        <ConfirmDialog.Root>
          <ConfirmDialog.Trigger
            render={<Button size="sm" type="button" variant="destructive" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionForm.Idle>
                <Message message="admin.coins.packs.retire_action" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.coins.packs.retiring" />
              </ActionForm.Pending>
            </Suspense>
          </ConfirmDialog.Trigger>
          <ConfirmDialog.Content>
            <ConfirmDialog.Header>
              <ConfirmDialog.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message="admin.coins.packs.retire_confirm_title" />
                </Suspense>
              </ConfirmDialog.Title>
              <ConfirmDialog.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message
                    message="admin.coins.packs.retire_confirm_description"
                    values={{ coin_name: coinName, pack: title }}
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
                  <Message message="admin.coins.packs.retire_confirm_action" />
                </Suspense>
              </ConfirmDialog.Action>
            </ConfirmDialog.Footer>
          </ConfirmDialog.Content>
        </ConfirmDialog.Root>
      </ActionForm.Fieldset>
    </ActionForm.Root>
  );
};
