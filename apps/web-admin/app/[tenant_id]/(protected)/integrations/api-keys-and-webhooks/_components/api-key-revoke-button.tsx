import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { ApiKeyItem } from "#lib/api-keys";
import { getMessages } from "#lib/get-messages";

import { revokeApiKeyAction } from "../_lib/actions";

/** Refuses one key from now on, once the administrator confirms it. */
export const ApiKeyRevokeButton = async ({
  apiKey,
  tenantId,
}: {
  apiKey: Pick<ApiKeyItem, "id" | "name">;
  tenantId: string;
}) => {
  const t = await getMessages();
  const formId = `revoke-api-key-${apiKey.id}`;

  return (
    <ActionForm.Root
      action={revokeApiKeyAction}
      className="grid justify-items-end gap-1"
      id={formId}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="api_key_id" type="hidden" value={apiKey.id} />
      <ConfirmDialog.Root>
        <ConfirmDialog.Trigger
          render={
            <Button
              aria-label={t("admin.settings.api_keys.revoke_aria", {
                name: apiKey.name,
              })}
              size="sm"
              type="button"
              variant="outline"
            />
          }
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <ActionForm.Idle>
              <Message message="admin.settings.api_keys.revoke" />
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="admin.settings.api_keys.revoking" />
            </ActionForm.Pending>
          </Suspense>
        </ConfirmDialog.Trigger>
        <ConfirmDialog.Content>
          <ConfirmDialog.Header>
            <ConfirmDialog.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message message="admin.settings.api_keys.revoke_confirm_title" />
              </Suspense>
            </ConfirmDialog.Title>
            <ConfirmDialog.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message
                  message="admin.settings.api_keys.revoke_confirm_description"
                  values={{ name: apiKey.name }}
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
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.settings.api_keys.revoke_confirm_action" />
              </Suspense>
            </ConfirmDialog.Action>
          </ConfirmDialog.Footer>
        </ConfirmDialog.Content>
      </ConfirmDialog.Root>
    </ActionForm.Root>
  );
};
