import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { TenantSmtpSettings } from "#lib/email-settings-shared";

import {
  sendTenantSmtpTestEmailAction,
  updateTenantEmailSettingsAction,
} from "../_lib/actions";
import * as SmtpOverride from "./smtp-override";
import * as SmtpPassword from "./smtp-password";
import * as SmtpTest from "./smtp-test";

/** The screen holds one settings form, which the test dialog's fields join. */
const formId = "tenant-smtp-settings";

interface TenantEmailSettingsFormProps {
  canEdit: boolean;
  /** The sender name used when none is set: the tenant's, or a generic one. */
  fromNamePlaceholder: string;
  initialSettings: TenantSmtpSettings;
  loadErrorMessage?: string;
  tenantId: string;
}

export const TenantEmailSettingsForm = ({
  canEdit,
  fromNamePlaceholder,
  initialSettings,
  loadErrorMessage,
  tenantId,
}: TenantEmailSettingsFormProps) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="admin.settings.email.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.email.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>
    {/* An `ActionForm` resets the fields only after its own save succeeds,
        so a test run from the dialog leaves what the operator typed. */}
    <ActionForm.Root
      action={updateTenantEmailSettingsAction}
      className="grid gap-5 sm:max-w-3xl"
      id={formId}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />

      {/* A save refreshes the settings; keying on them remounts the fields
          on what the API stored instead of changing a mounted default. */}
      <SmtpOverride.Root
        canEdit={canEdit}
        initialEnabled={initialSettings.smtpOverrideEnabled}
        key={JSON.stringify(initialSettings)}
      >
        <ActionForm.Fieldset className="grid gap-5">
          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.email.override" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <SmtpOverride.Checkbox>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <Message message="admin.settings.email.override_checkbox" />
                </Suspense>
              </SmtpOverride.Checkbox>
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.settings.email.override_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          <SmtpOverride.Fieldset className="grid gap-5">
            <Field.Root>
              <SmtpOverride.SettingLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.settings.email.host" />
                </Suspense>
              </SmtpOverride.SettingLabel>
              <Field.Content>
                <Input
                  defaultValue={initialSettings.host}
                  name="host"
                  placeholder="smtp.example.com"
                  required
                  type="text"
                />
              </Field.Content>
            </Field.Root>

            <Field.Root>
              <SmtpOverride.SettingLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.settings.email.port" />
                </Suspense>
              </SmtpOverride.SettingLabel>
              <Field.Content>
                <Input
                  defaultValue={String(initialSettings.port || 587)}
                  max={65_535}
                  min={1}
                  name="port"
                  required
                  type="number"
                />
              </Field.Content>
            </Field.Root>

            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.settings.email.username" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Input
                  defaultValue={initialSettings.username}
                  name="username"
                  type="text"
                />
                <ActionForm.FieldError name="username" />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.settings.email.username_description" />
                  </Suspense>
                </Field.Description>
              </Field.Content>
            </Field.Root>

            <SmtpPassword.Root hasStoredPassword={initialSettings.hasPassword}>
              <Field.Root>
                <Field.Label>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.settings.email.password" />
                  </Suspense>
                </Field.Label>
                <Field.Content>
                  <SmtpPassword.Stored>
                    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                      <Message message="admin.settings.email.password_change" />
                    </Suspense>
                  </SmtpPassword.Stored>
                  <SmtpPassword.Editor>
                    <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                      <Message message="admin.settings.email.password_change_cancel" />
                    </Suspense>
                  </SmtpPassword.Editor>
                  <SmtpPassword.Replacing>
                    <Field.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
                        <Message message="admin.settings.email.password_clear_description" />
                      </Suspense>
                    </Field.Description>
                  </SmtpPassword.Replacing>
                </Field.Content>
              </Field.Root>
            </SmtpPassword.Root>

            <Field.Root>
              <SmtpOverride.SettingLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.settings.email.encryption" />
                </Suspense>
              </SmtpOverride.SettingLabel>
              <Field.Content>
                <Select
                  defaultValue={initialSettings.encryption || "starttls"}
                  items={[
                    { label: "TLS", value: "tls" },
                    { label: "STARTTLS", value: "starttls" },
                    {
                      label: (
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-12" />}
                        >
                          <Message message="admin.settings.email.encryption_none" />
                        </Suspense>
                      ),
                      value: "none",
                    },
                  ]}
                  name="encryption"
                  required
                />
              </Field.Content>
            </Field.Root>

            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.settings.email.from_name" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Input
                  defaultValue={initialSettings.fromName}
                  name="from_name"
                  placeholder={fromNamePlaceholder}
                  type="text"
                />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.settings.email.from_name_description" />
                  </Suspense>
                </Field.Description>
              </Field.Content>
            </Field.Root>

            <Field.Root>
              <SmtpOverride.SettingLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
                  <Message message="admin.settings.email.from_address" />
                </Suspense>
              </SmtpOverride.SettingLabel>
              <Field.Content>
                <Input
                  defaultValue={initialSettings.fromAddress}
                  name="from_address"
                  placeholder="noreply@example.com"
                  required
                  type="email"
                />
              </Field.Content>
            </Field.Root>

            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                  <Message message="admin.settings.email.reply_to" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Input
                  defaultValue={initialSettings.replyTo}
                  name="reply_to"
                  placeholder="support@example.com"
                  type="email"
                />
              </Field.Content>
            </Field.Root>
          </SmtpOverride.Fieldset>
        </ActionForm.Fieldset>

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.admin_only" />
            </Suspense>
          </FormMessage>
        )}

        {loadErrorMessage ? (
          <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Dialog.Root>
            <SmtpTest.Trigger>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="admin.settings.email.test" />
              </Suspense>
            </SmtpTest.Trigger>
            <Dialog.Portal>
              <Dialog.Backdrop />
              <Dialog.Viewport>
                <Dialog.Popup>
                  <SmtpTest.Root
                    action={sendTenantSmtpTestEmailAction}
                    form={formId}
                  >
                    <Dialog.Header>
                      <Dialog.Title>
                        <Suspense
                          fallback={<SkeletonLine className="h-5 w-48" />}
                        >
                          <Message message="admin.settings.email.test_title" />
                        </Suspense>
                      </Dialog.Title>
                      <Dialog.Description>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-72" />}
                        >
                          <Message message="admin.settings.email.test_description" />
                        </Suspense>
                      </Dialog.Description>
                    </Dialog.Header>

                    <div className="mt-4 grid gap-4">
                      <SmtpTest.SendToSelf>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-32" />}
                        >
                          <Message message="admin.settings.email.test_send_to_self" />
                        </Suspense>
                      </SmtpTest.SendToSelf>
                      <SmtpTest.Recipient>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-40" />}
                        >
                          <Message message="admin.settings.email.test_recipient" />
                        </Suspense>
                      </SmtpTest.Recipient>
                      <SmtpTest.Result />
                    </div>

                    <Dialog.Footer>
                      <Dialog.Close
                        render={<Button type="button" variant="outline" />}
                      >
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-12" />}
                        >
                          <Message message="admin.settings.email.close" />
                        </Suspense>
                      </Dialog.Close>
                      <SmtpTest.Submit>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-20" />}
                        >
                          <ActionForm.Idle>
                            <Message message="admin.settings.email.test_submit" />
                          </ActionForm.Idle>
                          <ActionForm.Pending>
                            <Message message="admin.settings.email.test_sending" />
                          </ActionForm.Pending>
                        </Suspense>
                      </SmtpTest.Submit>
                    </Dialog.Footer>
                  </SmtpTest.Root>
                </Dialog.Popup>
              </Dialog.Viewport>
            </Dialog.Portal>
          </Dialog.Root>

          <ActionForm.Submit disabled={!canEdit}>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.save" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.settings.saving" />
              </ActionForm.Pending>
            </Suspense>
          </ActionForm.Submit>
        </div>
      </SmtpOverride.Root>
    </ActionForm.Root>
  </ConsoleSection.Root>
);
