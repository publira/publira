import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Switch } from "@publira/ui-components/switch";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { WebhookEventTypeValue } from "#lib/webhooks";
import { WEBHOOK_EVENT_TYPES } from "#lib/webhooks";

import { MAX_WEBHOOK_URL_LENGTH } from "../_lib/form-schemas";
import {
  WebhookEventDescription,
  WebhookEventLabel,
} from "./webhook-event-label";

interface WebhookEndpointFieldsProps {
  defaultEnabled: boolean;
  defaultEventTypes: readonly WebhookEventTypeValue[];
  defaultUrl: string;
}

/**
 * The URL, the events, and the switch an endpoint is saved with, shared by the
 * form that adds one and the form of each endpoint already saved. `type="url"`
 * is left off the input: the browser would accept an `http` URL as readily,
 * and the refusal the Action words says what it takes instead.
 */
export const WebhookEndpointFields = ({
  defaultEnabled,
  defaultEventTypes,
  defaultUrl,
}: WebhookEndpointFieldsProps) => (
  <>
    <Field.Root>
      <Field.Label required>
        <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
          <Message message="admin.settings.webhooks.url" />
        </Suspense>
      </Field.Label>
      <Field.Content>
        <Input
          autoComplete="off"
          defaultValue={defaultUrl}
          inputMode="url"
          maxLength={MAX_WEBHOOK_URL_LENGTH}
          name="url"
          placeholder="https://"
          required
          spellCheck={false}
          type="text"
        />
      </Field.Content>
      <Field.Description>
        <Suspense fallback={<SkeletonLine className="h-3 w-72" />}>
          <Message message="admin.settings.webhooks.url_description" />
        </Suspense>
      </Field.Description>
    </Field.Root>

    <fieldset className="grid gap-3">
      <legend className="mb-2 text-sm font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.settings.webhooks.events_legend" />
        </Suspense>
      </legend>
      {WEBHOOK_EVENT_TYPES.map((eventType) => (
        <Field.Root key={eventType}>
          <div className="flex items-center gap-2">
            <Checkbox
              defaultChecked={defaultEventTypes.includes(eventType)}
              name="event_types"
              value={eventType}
            />
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <WebhookEventLabel eventType={eventType} />
              </Suspense>
            </Field.Label>
          </div>
          <Field.Description>
            <code className="text-xs">{eventType}</code>{" "}
            <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
              <WebhookEventDescription eventType={eventType} />
            </Suspense>
          </Field.Description>
        </Field.Root>
      ))}
    </fieldset>

    <Field.Root className="grid-cols-[auto_1fr] items-start gap-x-3">
      <Switch
        className="row-span-2 mt-0.5"
        defaultChecked={defaultEnabled}
        name="enabled"
      />
      <Field.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.settings.webhooks.enabled" />
        </Suspense>
      </Field.Label>
      <Field.Description className="col-start-2">
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          <Message message="admin.settings.webhooks.enabled_description" />
        </Suspense>
      </Field.Description>
    </Field.Root>
  </>
);
