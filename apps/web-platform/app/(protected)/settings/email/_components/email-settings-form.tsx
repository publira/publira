import {
  ActionForm,
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
  DialogTrigger,
  DialogViewport,
} from "@publira/ui-components/dialog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  PlatformSection,
  PlatformSectionDescription,
  PlatformSectionHeader,
  PlatformSectionHeading,
  PlatformSectionTitle,
} from "#components/platform-page";
import type { PlatformSmtpSettings } from "#lib/email-settings-shared";

import type {
  PlatformEmailSettingsFormState,
  PlatformSmtpTestFormState,
} from "../../_lib/actions";
import {
  SmtpPassword,
  SmtpPasswordEditor,
  SmtpPasswordLabel,
  SmtpPasswordStored,
  SmtpRevisionField,
} from "./smtp-password-field";
import {
  SmtpTest,
  SmtpTestRecipient,
  SmtpTestResult,
  SmtpTestSendToSelf,
  SmtpTestSubmit,
} from "./smtp-test";

/** The screen holds one settings form, which the test dialog's fields join. */
const formId = "platform-smtp-settings";

interface EmailSettingsFormProps {
  initialSettings: PlatformSmtpSettings;
  loadErrorMessage?: string;
  saveAction: (
    prevState: PlatformEmailSettingsFormState,
    formData: FormData
  ) => Promise<PlatformEmailSettingsFormState>;
  testAction: (
    prevState: PlatformSmtpTestFormState,
    formData: FormData
  ) => Promise<PlatformSmtpTestFormState>;
}

export const EmailSettingsForm = ({
  initialSettings,
  loadErrorMessage,
  saveAction,
  testAction,
}: EmailSettingsFormProps) => (
  <PlatformSection>
    <PlatformSectionHeader>
      <PlatformSectionHeading>
        <PlatformSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
            <Message message="platform.settings.smtp_card_title" />
          </Suspense>
        </PlatformSectionTitle>
        <PlatformSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.settings.smtp_card_description" />
          </Suspense>
        </PlatformSectionDescription>
      </PlatformSectionHeading>
    </PlatformSectionHeader>
    {/* An `ActionForm` resets the fields only after its own save succeeds,
        so a test run from the dialog leaves what the operator typed. */}
    <ActionForm
      action={saveAction}
      className="grid gap-5 sm:max-w-3xl"
      id={formId}
    >
      <SmtpRevisionField revision={initialSettings.revision} />

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="platform.settings.host" />
          </Suspense>
        </FieldLabel>
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
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="platform.settings.port" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Input
            defaultValue={String(initialSettings.port || 587)}
            min={1}
            max={65_535}
            name="port"
            required
            type="number"
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="platform.settings.username" />
          </Suspense>
        </FieldLabel>
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
              <Message message="platform.settings.password" />
            </Suspense>
          </SmtpPasswordLabel>
          <FieldContent>
            <SmtpPasswordStored>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.settings.password_change" />
              </Suspense>
            </SmtpPasswordStored>
            <SmtpPasswordEditor>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="platform.settings.password_undo" />
              </Suspense>
            </SmtpPasswordEditor>
          </FieldContent>
        </Field>
      </SmtpPassword>

      <Field>
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="platform.settings.smtp_encryption" />
          </Suspense>
        </FieldLabel>
        <FieldContent>
          <Select
            defaultValue={initialSettings.encryption || "starttls"}
            items={[
              { label: "TLS", value: "tls" },
              { label: "STARTTLS", value: "starttls" },
              {
                label: (
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="platform.settings.encryption_none" />
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
        <FieldLabel required>
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="platform.settings.from_address" />
          </Suspense>
        </FieldLabel>
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
            <Message message="platform.settings.reply_to" />
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

      {loadErrorMessage ? (
        <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Dialog>
          <DialogTrigger render={<Button type="button" variant="outline" />}>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="platform.settings.smtp_test" />
            </Suspense>
          </DialogTrigger>
          <DialogPortal>
            <DialogBackdrop />
            <DialogViewport>
              <DialogPopup>
                <SmtpTest action={testAction} form={formId}>
                  <DialogHeader>
                    <DialogTitle>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-48" />}
                      >
                        <Message message="platform.settings.smtp_test_title" />
                      </Suspense>
                    </DialogTitle>
                    <DialogDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-72" />}
                      >
                        <Message message="platform.settings.smtp_test_description" />
                      </Suspense>
                    </DialogDescription>
                  </DialogHeader>

                  <div className="mt-4 grid gap-4">
                    <SmtpTestSendToSelf>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-40" />}
                      >
                        <Message message="platform.settings.smtp_test_self" />
                      </Suspense>
                    </SmtpTestSendToSelf>
                    <SmtpTestRecipient>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="platform.settings.smtp_test_custom" />
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
                        <Message message="platform.settings.smtp_test_close" />
                      </Suspense>
                    </DialogClose>
                    <SmtpTestSubmit>
                      <ActionFormIdle>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-20" />}
                        >
                          <Message message="platform.settings.smtp_test_submit" />
                        </Suspense>
                      </ActionFormIdle>
                      <ActionFormPending>
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-20" />}
                        >
                          <Message message="platform.settings.smtp_test_pending" />
                        </Suspense>
                      </ActionFormPending>
                    </SmtpTestSubmit>
                  </DialogFooter>
                </SmtpTest>
              </DialogPopup>
            </DialogViewport>
          </DialogPortal>
        </Dialog>

        <ActionFormSubmit>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="platform.common.save" />
          </Suspense>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  </PlatformSection>
);
