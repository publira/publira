import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";
import type { WebhookEndpointItem } from "#lib/webhooks";
import { MAX_WEBHOOK_ENDPOINTS } from "#lib/webhooks";

import { createWebhookEndpointAction } from "../_lib/actions";
import * as IssuedSecret from "./issued-secret";
import { WebhookEndpointCard } from "./webhook-endpoint-card";
import { WebhookEndpointFields } from "./webhook-endpoint-fields";

interface WebhookEndpointsSectionProps {
  endpoints: WebhookEndpointItem[];
  loadErrorMessage?: string;
  locale: Locale;
  tenantId: string;
  timeZone: string;
}

/**
 * Adds an endpoint, and shows its signing secret under the form the one time
 * the server answers it. The form stays on screen at the limit, closed, so
 * the secret of the fifth endpoint is not taken away with it.
 */
const WebhookEndpointCreateForm = async ({
  atLimit,
  disabled,
  tenantId,
}: {
  atLimit: boolean;
  disabled: boolean;
  tenantId: string;
}) => {
  const t = await getMessages();

  return (
    <ActionForm.Root
      action={createWebhookEndpointAction}
      className="grid gap-5 border-t border-border pt-5 sm:max-w-3xl"
    >
      <input name="tenant_id" type="hidden" value={tenantId} />

      <h3 className="text-base font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
          <Message message="admin.settings.webhooks.add_title" />
        </Suspense>
      </h3>

      {atLimit ? (
        <FormMessage variant="warning">
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message
              message="admin.settings.webhooks.limit_reached"
              values={{ count: MAX_WEBHOOK_ENDPOINTS }}
            />
          </Suspense>
        </FormMessage>
      ) : null}

      <ActionForm.Fieldset
        className="grid gap-5"
        disabled={disabled || atLimit}
      >
        <WebhookEndpointFields
          defaultEnabled
          defaultEventTypes={[]}
          defaultUrl=""
        />
      </ActionForm.Fieldset>

      <div className="flex justify-end">
        <ActionForm.Submit disabled={disabled || atLimit}>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <ActionForm.Idle>
              <Message message="admin.settings.webhooks.add" />
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="admin.settings.webhooks.adding" />
            </ActionForm.Pending>
          </Suspense>
        </ActionForm.Submit>
      </div>

      <IssuedSecret.Root>
        <IssuedSecret.Title>
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="admin.settings.webhooks.issued_title" />
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
  );
};

/** The tenant's endpoints, each a form of its own, and the form that adds one. */
export const WebhookEndpointsSection = ({
  endpoints,
  loadErrorMessage,
  locale,
  tenantId,
  timeZone,
}: WebhookEndpointsSectionProps) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
            <Message message="admin.settings.webhooks.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message
              message="admin.settings.webhooks.description"
              values={{ count: MAX_WEBHOOK_ENDPOINTS }}
            />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>

    {loadErrorMessage ? (
      <FormMessage className="sm:max-w-3xl" variant="destructive">
        {loadErrorMessage}
      </FormMessage>
    ) : null}

    {!loadErrorMessage && endpoints.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <Message message="admin.settings.webhooks.empty" />
        </Suspense>
      </p>
    ) : null}

    {endpoints.map((endpoint) => (
      <Suspense
        fallback={<SkeletonLine className="h-64 w-full sm:max-w-3xl" />}
        key={endpoint.id}
      >
        <WebhookEndpointCard
          endpoint={endpoint}
          locale={locale}
          tenantId={tenantId}
          timeZone={timeZone}
        />
      </Suspense>
    ))}

    <Suspense fallback={<SkeletonLine className="h-64 w-full sm:max-w-3xl" />}>
      <WebhookEndpointCreateForm
        atLimit={endpoints.length >= MAX_WEBHOOK_ENDPOINTS}
        disabled={Boolean(loadErrorMessage)}
        tenantId={tenantId}
      />
    </Suspense>
  </ConsoleSection.Root>
);
