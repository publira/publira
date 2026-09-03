"use client";

import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
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
import type { ChangeEvent } from "react";
import { useActionState, useCallback, useId, useState } from "react";

import { ClientMessage } from "#components/client-message";
import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "#lib/email-settings-shared";
import type { PlatformSmtpSettings } from "#lib/email-settings-shared";

import type {
  PlatformEmailSettingsFormState,
  PlatformSmtpTestFormState,
} from "../../_lib/actions";

const encryptionOptions = [
  { label: "TLS", value: "tls" },
  { label: "STARTTLS", value: "starttls" },
  {
    label: <ClientMessage message="platform.settings.encryption_none" />,
    value: "none",
  },
];

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
}: EmailSettingsFormProps) => {
  const formId = useId();
  // Seeded once per mount; saving is what replaces it, with the settings the
  // server confirmed. A stored password is shown masked until the operator asks
  // to change it, and saving puts it back behind that mask.
  const [hasStoredPassword, setHasStoredPassword] = useState(
    initialSettings.hasPassword
  );
  const [isPasswordEditing, setIsPasswordEditing] = useState(
    !initialSettings.hasPassword
  );
  const [sendToSelf, setSendToSelf] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [saveState, saveFormAction, isSaving] = useActionState(
    async (
      previousState: PlatformEmailSettingsFormState,
      formData: FormData
    ): Promise<PlatformEmailSettingsFormState> => {
      const nextState = await saveAction(previousState, formData);
      if (nextState?.ok) {
        setHasStoredPassword(nextState.settings.hasPassword);
        setIsPasswordEditing(!nextState.settings.hasPassword);
      }
      return nextState;
    },
    null
  );
  const [testState, testFormAction, isTesting] = useActionState(
    testAction,
    null
  );

  const handleStartPasswordEdit = useCallback(() => {
    setIsPasswordEditing(true);
  }, []);

  const handleCancelPasswordEdit = useCallback(() => {
    setIsPasswordEditing(false);
  }, []);

  const handleSendToSelfChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setSendToSelf(event.target.checked);
    },
    []
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <ClientMessage message="platform.settings.smtp_card_title" />
        </CardTitle>
        <CardDescription>
          <ClientMessage message="platform.settings.smtp_card_description" />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={saveFormAction}
          className="grid gap-5 sm:max-w-3xl"
          id={formId}
        >
          <Field>
            <FieldLabel htmlFor="host" required>
              <ClientMessage message="platform.settings.host" />
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={initialSettings.host}
                id="host"
                name="host"
                placeholder="smtp.example.com"
                required
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="port" required>
              <ClientMessage message="platform.settings.port" />
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={String(initialSettings.port || 587)}
                id="port"
                min={1}
                max={65_535}
                name="port"
                required
                type="number"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="username" required>
              <ClientMessage message="platform.settings.username" />
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={initialSettings.username}
                id="username"
                name="username"
                required
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="password" required={isPasswordEditing}>
              <ClientMessage message="platform.settings.password" />
            </FieldLabel>
            <FieldContent>
              {hasStoredPassword && !isPasswordEditing ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    defaultValue="****"
                    disabled
                    key="password-masked"
                    readOnly
                    type="password"
                  />
                  <Button
                    onClick={handleStartPasswordEdit}
                    type="button"
                    variant="outline"
                  >
                    <ClientMessage message="platform.settings.password_change" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    autoComplete="new-password"
                    id="password"
                    key="password-editable"
                    name="password"
                    required={isPasswordEditing}
                    type="password"
                  />
                  {hasStoredPassword ? (
                    <Button
                      onClick={handleCancelPasswordEdit}
                      type="button"
                      variant="outline"
                    >
                      <ClientMessage message="platform.settings.password_undo" />
                    </Button>
                  ) : null}
                </div>
              )}

              <input
                name="password_update_mode"
                type="hidden"
                value={
                  hasStoredPassword && !isPasswordEditing
                    ? String(SECRET_UPDATE_MODE_UNCHANGED)
                    : String(SECRET_UPDATE_MODE_REPLACE)
                }
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="encryption" required>
              <ClientMessage message="platform.settings.smtp_encryption" />
            </FieldLabel>
            <FieldContent>
              <Select
                defaultValue={initialSettings.encryption || "starttls"}
                id="encryption"
                items={encryptionOptions}
                name="encryption"
                required
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="from_address" required>
              <ClientMessage message="platform.settings.from_address" />
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={initialSettings.fromAddress}
                id="from_address"
                name="from_address"
                placeholder="noreply@example.com"
                required
                type="email"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="reply_to">
              <ClientMessage message="platform.settings.reply_to" />
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={initialSettings.replyTo}
                id="reply_to"
                name="reply_to"
                placeholder="support@example.com"
                type="email"
              />
            </FieldContent>
          </Field>

          {loadErrorMessage ? (
            <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
          ) : null}

          {saveState ? (
            <FormMessage variant={saveState.ok ? "success" : "destructive"}>
              {saveState.message}
            </FormMessage>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
              <DialogTrigger
                render={
                  <Button type="button" variant="outline">
                    <ClientMessage message="platform.settings.smtp_test" />
                  </Button>
                }
              />
              <DialogPortal>
                <DialogBackdrop />
                <DialogViewport>
                  <DialogPopup>
                    <DialogHeader>
                      <DialogTitle>
                        <ClientMessage message="platform.settings.smtp_test_title" />
                      </DialogTitle>
                      <DialogDescription>
                        <ClientMessage message="platform.settings.smtp_test_description" />
                      </DialogDescription>
                    </DialogHeader>

                    <div className="mt-4 grid gap-4">
                      <label className="inline-flex items-center gap-2 text-sm text-foreground">
                        <input
                          checked={sendToSelf}
                          onChange={handleSendToSelfChange}
                          type="checkbox"
                        />
                        <ClientMessage message="platform.settings.smtp_test_self" />
                      </label>
                      <input
                        form={formId}
                        name="recipient_type"
                        type="hidden"
                        value={
                          sendToSelf
                            ? String(TEST_EMAIL_RECIPIENT_TYPE_SELF)
                            : String(TEST_EMAIL_RECIPIENT_TYPE_CUSTOM)
                        }
                      />

                      {sendToSelf ? null : (
                        <Field>
                          <FieldLabel htmlFor="recipient_email" required>
                            <ClientMessage message="platform.settings.smtp_test_custom" />
                          </FieldLabel>
                          <FieldContent>
                            <Input
                              form={formId}
                              id="recipient_email"
                              name="recipient_email"
                              placeholder="recipient@example.com"
                              required={!sendToSelf}
                              type="email"
                            />
                          </FieldContent>
                        </Field>
                      )}

                      {testState ? (
                        <FormMessage
                          variant={testState.ok ? "success" : "destructive"}
                        >
                          {testState.message}
                        </FormMessage>
                      ) : null}
                    </div>

                    <DialogFooter>
                      <DialogClose
                        render={
                          <Button type="button" variant="outline">
                            <ClientMessage message="platform.settings.smtp_test_close" />
                          </Button>
                        }
                      />
                      <Button
                        disabled={isTesting}
                        form={formId}
                        formAction={testFormAction}
                        type="submit"
                        variant="outline"
                      >
                        <ClientMessage message="platform.settings.smtp_test_submit" />
                      </Button>
                    </DialogFooter>
                  </DialogPopup>
                </DialogViewport>
              </DialogPortal>
            </Dialog>

            <Button disabled={isSaving} type="submit">
              <ClientMessage message="platform.common.save" />
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
