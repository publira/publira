import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import { StatusChip } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";
import type { WebhookEndpointItem } from "#lib/webhooks";

import {
  deleteWebhookEndpointAction,
  rotateWebhookSecretAction,
  sendTestWebhookAction,
  updateWebhookEndpointAction,
} from "../_lib/actions";
import * as IssuedSecret from "./issued-secret";
import { WebhookEndpointFields } from "./webhook-endpoint-fields";

interface WebhookEndpointCardProps {
  endpoint: WebhookEndpointItem;
  locale: Locale;
  tenantId: string;
  timeZone: string;
}

/** The hidden fields every form of one endpoint posts. */
const EndpointIdFields = ({
  endpointId,
  tenantId,
}: {
  endpointId: string;
  tenantId: string;
}) => (
  <>
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="endpoint_id" type="hidden" value={endpointId} />
  </>
);

/**
 * One saved endpoint: a form each for sending a test event and deleting it
 * beside its URL, one for rotating its secret under the secret's hint, and its
 * own form for the URL, the events, and the switch. The forms are siblings
 * rather than nested, and each reports its own outcome under itself.
 */
export const WebhookEndpointCard = async ({
  endpoint,
  locale,
  tenantId,
  timeZone,
}: WebhookEndpointCardProps) => {
  const t = await getMessages();
  const headingId = `webhook-endpoint-${endpoint.id}`;
  const rotateFormId = `rotate-webhook-secret-${endpoint.id}`;
  const deleteFormId = `delete-webhook-endpoint-${endpoint.id}`;

  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-5 border-t border-border pt-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3
            className="min-w-0 text-base font-medium break-all text-foreground"
            id={headingId}
          >
            {endpoint.url}
          </h3>
          {endpoint.enabled ? (
            <StatusChip status="success">
              <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                <Message message="admin.settings.webhooks.status_enabled" />
              </Suspense>
            </StatusChip>
          ) : (
            <StatusChip status="muted">
              <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                <Message message="admin.settings.webhooks.status_disabled" />
              </Suspense>
            </StatusChip>
          )}
        </div>
        <div className="flex flex-wrap items-start gap-2 sm:justify-end">
          <ActionForm.Root
            action={sendTestWebhookAction}
            className="grid justify-items-end gap-1"
          >
            <EndpointIdFields endpointId={endpoint.id} tenantId={tenantId} />
            <ActionForm.Submit size="sm" variant="outline">
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <ActionForm.Idle>
                  <Message message="admin.settings.webhooks.send_test" />
                </ActionForm.Idle>
                <ActionForm.Pending>
                  <Message message="admin.settings.webhooks.sending_test" />
                </ActionForm.Pending>
              </Suspense>
            </ActionForm.Submit>
          </ActionForm.Root>

          <ActionForm.Root
            action={deleteWebhookEndpointAction}
            className="grid justify-items-end gap-1"
            id={deleteFormId}
          >
            <EndpointIdFields endpointId={endpoint.id} tenantId={tenantId} />
            <ConfirmDialog.Root>
              <ConfirmDialog.Trigger
                render={
                  <Button size="sm" type="button" variant="destructive" />
                }
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                  <ActionForm.Idle>
                    <Message message="admin.settings.webhooks.delete" />
                  </ActionForm.Idle>
                  <ActionForm.Pending>
                    <Message message="admin.settings.webhooks.deleting" />
                  </ActionForm.Pending>
                </Suspense>
              </ConfirmDialog.Trigger>
              <ConfirmDialog.Content>
                <ConfirmDialog.Header>
                  <ConfirmDialog.Title>
                    <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                      <Message message="admin.settings.webhooks.delete_confirm_title" />
                    </Suspense>
                  </ConfirmDialog.Title>
                  <ConfirmDialog.Description>
                    <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                      <Message message="admin.settings.webhooks.delete_confirm_description" />
                    </Suspense>
                  </ConfirmDialog.Description>
                </ConfirmDialog.Header>
                <ConfirmDialog.Footer>
                  <ConfirmDialog.Cancel>
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <Message message="admin.common.cancel" />
                    </Suspense>
                  </ConfirmDialog.Cancel>
                  <ConfirmDialog.Action form={deleteFormId}>
                    <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                      <Message message="admin.settings.webhooks.delete_confirm_action" />
                    </Suspense>
                  </ConfirmDialog.Action>
                </ConfirmDialog.Footer>
              </ConfirmDialog.Content>
            </ConfirmDialog.Root>
          </ActionForm.Root>
        </div>
      </div>

      <div className="grid gap-3 sm:max-w-3xl">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.settings.webhooks.secret" />
            </Suspense>
          </dt>
          <dd className="tabular-nums">{endpoint.secretHint}</dd>
          <dt className="text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.settings.webhooks.updated_at" />
            </Suspense>
          </dt>
          <dd className="tabular-nums">
            {formatDateTime(endpoint.updatedAt, { locale, timeZone })}
          </dd>
        </dl>
        <ActionForm.Root
          action={rotateWebhookSecretAction}
          className="grid justify-items-start gap-3"
          id={rotateFormId}
        >
          <EndpointIdFields endpointId={endpoint.id} tenantId={tenantId} />
          <ConfirmDialog.Root>
            <ConfirmDialog.Trigger
              render={<Button size="sm" type="button" variant="outline" />}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <ActionForm.Idle>
                  <Message message="admin.settings.webhooks.rotate" />
                </ActionForm.Idle>
                <ActionForm.Pending>
                  <Message message="admin.settings.webhooks.rotating" />
                </ActionForm.Pending>
              </Suspense>
            </ConfirmDialog.Trigger>
            <ConfirmDialog.Content>
              <ConfirmDialog.Header>
                <ConfirmDialog.Title>
                  <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                    <Message message="admin.settings.webhooks.rotate_confirm_title" />
                  </Suspense>
                </ConfirmDialog.Title>
                <ConfirmDialog.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                    <Message message="admin.settings.webhooks.rotate_confirm_description" />
                  </Suspense>
                </ConfirmDialog.Description>
              </ConfirmDialog.Header>
              <ConfirmDialog.Footer>
                <ConfirmDialog.Cancel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.common.cancel" />
                  </Suspense>
                </ConfirmDialog.Cancel>
                <ConfirmDialog.Action form={rotateFormId}>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.settings.webhooks.rotate_confirm_action" />
                  </Suspense>
                </ConfirmDialog.Action>
              </ConfirmDialog.Footer>
            </ConfirmDialog.Content>
          </ConfirmDialog.Root>
          <IssuedSecret.Root>
            <IssuedSecret.Title>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.webhooks.rotated_title" />
              </Suspense>
            </IssuedSecret.Title>
            <IssuedSecret.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.webhooks.issued_description" />
              </Suspense>
            </IssuedSecret.Description>
            <IssuedSecret.Value
              aria-label={t("admin.settings.webhooks.copy_secret")}
            />
          </IssuedSecret.Root>
        </ActionForm.Root>
      </div>

      <ActionForm.Root
        action={updateWebhookEndpointAction}
        className="grid gap-5 sm:max-w-3xl"
      >
        <EndpointIdFields endpointId={endpoint.id} tenantId={tenantId} />
        <ActionForm.Fieldset className="grid gap-5">
          <WebhookEndpointFields
            defaultEnabled={endpoint.enabled}
            defaultEventTypes={endpoint.eventTypes}
            defaultUrl={endpoint.url}
          />
        </ActionForm.Fieldset>
        <div className="flex justify-end">
          <ActionForm.Submit>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.webhooks.save" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.settings.saving" />
              </ActionForm.Pending>
            </Suspense>
          </ActionForm.Submit>
        </div>
      </ActionForm.Root>
    </section>
  );
};
