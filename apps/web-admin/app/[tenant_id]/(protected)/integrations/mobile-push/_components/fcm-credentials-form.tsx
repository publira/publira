import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { cn, formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { TenantFcmSettings } from "#lib/fcm-settings";

import { saveFcmCredentialsAction } from "../_lib/actions";
import { FcmCredentialsDeleteButton } from "./fcm-credentials-delete-button";

const labelClassName = cn("text-sm text-muted-foreground");
const valueClassName = cn("min-w-0 text-sm break-all");

interface FcmCredentialsFormProps {
  loadErrorMessage?: string;
  locale: Locale;
  settings: TenantFcmSettings;
  tenantId: string;
  timeZone: string;
}

/**
 * The tenant's Firebase credentials, shown only as present or absent: the key
 * file goes up once and is never sent back to the browser.
 */
export const FcmCredentialsForm = ({
  loadErrorMessage,
  locale,
  settings,
  tenantId,
  timeZone,
}: FcmCredentialsFormProps) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.mobile_push.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
      {!loadErrorMessage && settings.configured ? (
        <ConsoleSection.Actions>
          <FcmCredentialsDeleteButton tenantId={tenantId} />
        </ConsoleSection.Actions>
      ) : null}
    </ConsoleSection.Header>

    {loadErrorMessage ? (
      <FormMessage className="sm:max-w-3xl" variant="destructive">
        {loadErrorMessage}
      </FormMessage>
    ) : null}
    {!loadErrorMessage && settings.configured ? (
      <FormMessage className="sm:max-w-3xl" variant="success">
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          <Message message="admin.settings.mobile_push.configured" />
        </Suspense>
      </FormMessage>
    ) : null}
    {loadErrorMessage || settings.configured ? null : (
      <FormMessage className="sm:max-w-3xl" variant="warning">
        <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
          <Message message="admin.settings.mobile_push.unconfigured" />
        </Suspense>
      </FormMessage>
    )}

    {!loadErrorMessage && settings.configured ? (
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.settings.mobile_push.project_id" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>{settings.projectId}</dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.settings.mobile_push.client_email" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>{settings.clientEmail}</dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.settings.mobile_push.updated_at" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>
          {formatDateTime(settings.updatedAt, { locale, timeZone })}
        </dd>
      </dl>
    ) : null}

    <ActionForm.Root
      action={saveFcmCredentialsAction}
      className="grid gap-5 sm:max-w-3xl"
    >
      <input name="tenant_id" type="hidden" value={tenantId} />

      <ActionForm.Fieldset className="grid gap-5">
        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.settings.mobile_push.project_id" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              autoComplete="off"
              defaultValue={settings.projectId}
              disabled={Boolean(loadErrorMessage)}
              name="project_id"
              required
              spellCheck={false}
              type="text"
            />
          </Field.Content>
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
              <Message message="admin.settings.mobile_push.project_id_description" />
            </Suspense>
          </Field.Description>
        </Field.Root>

        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.settings.mobile_push.key_file" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              accept="application/json,.json"
              disabled={Boolean(loadErrorMessage)}
              name="service_account_file"
              required
              type="file"
            />
          </Field.Content>
          <Field.Description>
            <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
              <Message message="admin.settings.mobile_push.key_file_description" />
            </Suspense>
          </Field.Description>
        </Field.Root>
      </ActionForm.Fieldset>

      <div className="flex justify-end">
        <ActionForm.Submit disabled={Boolean(loadErrorMessage)}>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <ActionForm.Idle>
              {settings.configured ? (
                <Message message="admin.settings.mobile_push.replace" />
              ) : (
                <Message message="admin.settings.mobile_push.save" />
              )}
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="admin.settings.saving" />
            </ActionForm.Pending>
          </Suspense>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  </ConsoleSection.Root>
);
