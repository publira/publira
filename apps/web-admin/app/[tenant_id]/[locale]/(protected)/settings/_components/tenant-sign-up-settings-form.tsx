import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Switch } from "@publira/ui-components/switch";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { TenantSignUpSettings } from "#lib/tenant-sign-up-settings";
import { MAX_SIGN_UP_CLOSED_MESSAGE_LENGTH } from "#lib/tenant-sign-up-settings-shared";

import { updateTenantSignUpSettingsAction } from "../_lib/actions";

interface TenantSignUpSettingsFormProps {
  canEdit: boolean;
  /** The saved values, absent when the settings read failed. */
  initialSettings?: TenantSignUpSettings;
  loadErrorMessage?: string;
  tenantId: string;
}

export const TenantSignUpSettingsForm = ({
  canEdit,
  initialSettings,
  loadErrorMessage,
  tenantId,
}: TenantSignUpSettingsFormProps) => {
  // Without the saved settings a save would open or close sign-up on whatever
  // the switch happened to show, so editing stays closed until the read succeeds.
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="admin.settings.sign_up.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.sign_up.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updateTenantSignUpSettingsAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        {/* A switch someone threw and forgot is easy to miss, so a closed
            sign-up is said in words and not left to the switch's position. */}
        {initialSettings?.signUpOpen === false ? (
          <FormMessage variant="warning">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.sign_up.closed_notice" />
            </Suspense>
          </FormMessage>
        ) : null}

        <ActionForm.Fieldset className="grid gap-4" disabled={fieldsDisabled}>
          <Field.Root className="grid-cols-[auto_1fr] items-start gap-x-3">
            <Switch
              className="row-span-2 mt-0.5"
              defaultChecked={initialSettings?.signUpOpen ?? true}
              name="sign_up_open"
            />
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.sign_up.open_label" />
              </Suspense>
            </Field.Label>
            <Field.Description className="col-start-2">
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="admin.settings.sign_up.open_description" />
              </Suspense>
            </Field.Description>
          </Field.Root>

          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="admin.settings.sign_up.message_label" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Textarea
                defaultValue={initialSettings?.closedMessage ?? ""}
                name="closed_message"
                rows={4}
              />
              <ActionForm.FieldError name="closedMessage" />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message
                    message="admin.settings.sign_up.message_description"
                    values={{ max: MAX_SIGN_UP_CLOSED_MESSAGE_LENGTH }}
                  />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>
        </ActionForm.Fieldset>

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.admin_only" />
            </Suspense>
          </FormMessage>
        )}

        {loadErrorMessage ? (
          <FormMessage variant="destructive">
            <span className="block">{loadErrorMessage}</span>
            <span className="block">
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.settings.sign_up.load_error_hint" />
              </Suspense>
            </span>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionForm.Submit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.sign_up.submit" />
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
};
