import type { Locale } from "@publira/i18n";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { cn, formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "#components/action-form";
import {
  AdminSection,
  AdminSectionActions,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
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
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
            <Message message="admin.settings.mobile_push.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.mobile_push.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
      {!loadErrorMessage && settings.configured ? (
        <AdminSectionActions>
          <FcmCredentialsDeleteButton tenantId={tenantId} />
        </AdminSectionActions>
      ) : null}
    </AdminSectionHeader>

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

    <ActionForm
      action={saveFcmCredentialsAction}
      className="grid gap-5 sm:max-w-3xl"
    >
      <input name="tenant_id" type="hidden" value={tenantId} />

      <ActionFormFieldset className="grid gap-5">
        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.settings.mobile_push.project_id" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              autoComplete="off"
              defaultValue={settings.projectId}
              disabled={Boolean(loadErrorMessage)}
              name="project_id"
              required
              spellCheck={false}
              type="text"
            />
          </FieldContent>
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
              <Message message="admin.settings.mobile_push.project_id_description" />
            </Suspense>
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.settings.mobile_push.key_file" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              accept="application/json,.json"
              disabled={Boolean(loadErrorMessage)}
              name="service_account_file"
              required
              type="file"
            />
          </FieldContent>
          <FieldDescription>
            <Suspense fallback={<SkeletonLine className="h-3 w-64" />}>
              <Message message="admin.settings.mobile_push.key_file_description" />
            </Suspense>
          </FieldDescription>
        </Field>
      </ActionFormFieldset>

      <div className="flex justify-end">
        <ActionFormSubmit disabled={Boolean(loadErrorMessage)}>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <ActionFormIdle>
              {settings.configured ? (
                <Message message="admin.settings.mobile_push.replace" />
              ) : (
                <Message message="admin.settings.mobile_push.save" />
              )}
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="admin.settings.saving" />
            </ActionFormPending>
          </Suspense>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  </AdminSection>
);
