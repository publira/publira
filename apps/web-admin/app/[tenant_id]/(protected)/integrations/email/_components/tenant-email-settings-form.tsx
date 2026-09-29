import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogViewport,
} from "@publira/ui-components/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import type { TenantSmtpSettings } from "#lib/email-settings-shared";

import {
  sendTenantSmtpTestEmailAction,
  updateTenantEmailSettingsAction,
} from "../_lib/actions";
import {
  SmtpOverride,
  SmtpOverrideCheckbox,
  SmtpOverrideFieldset,
  SmtpPassword,
  SmtpPasswordEditor,
  SmtpPasswordLabel,
  SmtpPasswordStored,
  SmtpSettingLabel,
  SmtpTest,
  SmtpTestRecipient,
  SmtpTestResult,
  SmtpTestSendToSelf,
  SmtpTestSubmit,
  SmtpTestTrigger,
} from "./smtp-settings-controls";

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
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
            <Message message="admin.settings.email.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.email.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    {/* An `ActionForm` resets the fields only after its own save succeeds,
        so a test run from the dialog leaves what the operator typed. */}
    <ActionForm
      action={updateTenantEmailSettingsAction}
      className="grid gap-5 sm:max-w-3xl"
      id={formId}
    >
      <input name="tenant_id" type="hidden" value={tenantId} />

      {/* A save refreshes the settings; keying on them remounts the fields
          on what the API stored instead of changing a mounted default. */}
      <SmtpOverride
        canEdit={canEdit}
        initialEnabled={initialSettings.smtpOverrideEnabled}
        key={JSON.stringify(initialSettings)}
      >
        <ActionFormFieldset className="grid gap-5">
          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.settings.email.override" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <SmtpOverrideCheckbox>
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <Message message="admin.settings.email.override_checkbox" />
                </Suspense>
              </SmtpOverrideCheckbox>
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.settings.email.override_description" />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>

          <SmtpOverrideFieldset className="grid gap-5">
            <Field>
              <SmtpSettingLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.settings.email.host" />
                </Suspense>
              </SmtpSettingLabel>
              <FieldContent>
                <Input
                  defaultValue={initialSettings.host}
                  name="host"
                  placeholder="smtp.example.com"
                  required
                  type="text"
                />
              </FieldContent>
            </Field>

            <Field>
              <SmtpSettingLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.settings.email.port" />
                </Suspense>
              </SmtpSettingLabel>
              <FieldContent>
                <Input
                  defaultValue={String(initialSettings.port || 587)}
                  max={65_535}
                  min={1}
                  name="port"
                  required
                  type="number"
                />
              </FieldContent>
            </Field>

            <Field>
              <SmtpSettingLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message message="admin.settings.email.username" />
                </Suspense>
              </SmtpSettingLabel>
              <FieldContent>
                <Input
                  defaultValue={initialSettings.username}
                  name="username"
                  required
                  type="text"
                />
              </FieldContent>
            </Field>

            <SmtpPassword hasStoredPassword={initialSettings.hasPassword}>
              <Field>
                <SmtpPasswordLabel>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="admin.settings.email.password" />
                  </Suspense>
                </SmtpPasswordLabel>
                <FieldContent>
                  <SmtpPasswordStored>
                    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                      <Message message="admin.settings.email.password_change" />
                    </Suspense>
                  </SmtpPasswordStored>
                  <SmtpPasswordEditor>
                    <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                      <Message message="admin.settings.email.password_change_cancel" />
                    </Suspense>
                  </SmtpPasswordEditor>
                </FieldContent>
              </Field>
            </SmtpPassword>

            <Field>
              <SmtpSettingLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.settings.email.encryption" />
                </Suspense>
              </SmtpSettingLabel>
              <FieldContent>
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
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.settings.email.from_name" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <Input
                  defaultValue={initialSettings.fromName}
                  name="from_name"
                  placeholder={fromNamePlaceholder}
                  type="text"
                />
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.settings.email.from_name_description" />
                  </Suspense>
                </FieldDescription>
              </FieldContent>
            </Field>

            <Field>
              <SmtpSettingLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
                  <Message message="admin.settings.email.from_address" />
                </Suspense>
              </SmtpSettingLabel>
              <FieldContent>
                <Input
                  defaultValue={initialSettings.fromAddress}
                  name="from_address"
                  placeholder="noreply@example.com"
                  required
                  type="email"
                />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                  <Message message="admin.settings.email.reply_to" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <Input
                  defaultValue={initialSettings.replyTo}
                  name="reply_to"
                  placeholder="support@example.com"
                  type="email"
                />
              </FieldContent>
            </Field>
          </SmtpOverrideFieldset>
        </ActionFormFieldset>

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
          <Dialog>
            <SmtpTestTrigger>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="admin.settings.email.test" />
              </Suspense>
            </SmtpTestTrigger>
            <DialogPortal>
              <DialogBackdrop />
              <DialogViewport>
                <DialogPopup>
                  <SmtpTest
                    action={sendTenantSmtpTestEmailAction}
                    form={formId}
                  >
                    <DialogHeader>
                      <DialogTitle>
                        <Suspense
                          fallback={<SkeletonLine className="h-5 w-48" />}
                        >
                          <Message message="admin.settings.email.test_title" />
                        </Suspense>
                      </DialogTitle>
                      <DialogDescription>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-72" />}
                        >
                          <Message message="admin.settings.email.test_description" />
                        </Suspense>
                      </DialogDescription>
                    </DialogHeader>

                    <div className="mt-4 grid gap-4">
                      <SmtpTestSendToSelf>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-32" />}
                        >
                          <Message message="admin.settings.email.test_send_to_self" />
                        </Suspense>
                      </SmtpTestSendToSelf>
                      <SmtpTestRecipient>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-40" />}
                        >
                          <Message message="admin.settings.email.test_recipient" />
                        </Suspense>
                      </SmtpTestRecipient>
                      <SmtpTestResult />
                    </div>

                    <DialogFooter>
                      <DialogClose
                        render={<Button type="button" variant="outline" />}
                      >
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-12" />}
                        >
                          <Message message="admin.settings.email.close" />
                        </Suspense>
                      </DialogClose>
                      <SmtpTestSubmit>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-20" />}
                        >
                          <ActionFormIdle>
                            <Message message="admin.settings.email.test_submit" />
                          </ActionFormIdle>
                          <ActionFormPending>
                            <Message message="admin.settings.email.test_sending" />
                          </ActionFormPending>
                        </Suspense>
                      </SmtpTestSubmit>
                    </DialogFooter>
                  </SmtpTest>
                </DialogPopup>
              </DialogViewport>
            </DialogPortal>
          </Dialog>

          <ActionFormSubmit disabled={!canEdit}>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ActionFormIdle>
                <Message message="admin.settings.save" />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message="admin.settings.saving" />
              </ActionFormPending>
            </Suspense>
          </ActionFormSubmit>
        </div>
      </SmtpOverride>
    </ActionForm>
  </AdminSection>
);
