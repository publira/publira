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

export interface EmailSettingsFormCopy {
  cardDescription: string;
  cardTitle: string;
  encryptionLabel: string;
  encryptionNone: string;
  fromAddress: string;
  host: string;
  password: string;
  passwordChange: string;
  passwordUndo: string;
  port: string;
  replyTo: string;
  save: string;
  saving: string;
  test: string;
  testClose: string;
  testCustom: string;
  testDescription: string;
  testPending: string;
  testSelf: string;
  testSubmit: string;
  testTitle: string;
  username: string;
}

interface EmailSettingsFormProps {
  copy: EmailSettingsFormCopy;
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
  copy,
  initialSettings,
  loadErrorMessage,
  saveAction,
  testAction,
}: EmailSettingsFormProps) => {
  const formId = useId();
  const [saveState, saveFormAction, isSaving] = useActionState(
    saveAction,
    null
  );
  const [testState, testFormAction, isTesting] = useActionState(
    testAction,
    null
  );
  const [hasStoredPassword, setHasStoredPassword] = useState(
    initialSettings.hasPassword
  );
  const [isPasswordEditing, setIsPasswordEditing] = useState(
    !initialSettings.hasPassword
  );
  const [sendToSelf, setSendToSelf] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prevSaveState, setPrevSaveState] = useState(saveState);

  if (saveState !== prevSaveState) {
    setPrevSaveState(saveState);
    if (saveState?.ok) {
      setHasStoredPassword(saveState.settings.hasPassword);
      setIsPasswordEditing(!saveState.settings.hasPassword);
    }
  }

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

  const encryptionOptions = [
    { label: "TLS", value: "tls" },
    { label: "STARTTLS", value: "starttls" },
    { label: copy.encryptionNone, value: "none" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.cardTitle}</CardTitle>
        <CardDescription>{copy.cardDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={saveFormAction}
          className="grid gap-5 sm:max-w-3xl"
          id={formId}
        >
          <Field>
            <FieldLabel htmlFor="host" required>
              {copy.host}
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
              {copy.port}
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
              {copy.username}
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
              {copy.password}
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
                    {copy.passwordChange}
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
                      {copy.passwordUndo}
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
              {copy.encryptionLabel}
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
              {copy.fromAddress}
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
            <FieldLabel htmlFor="reply_to">{copy.replyTo}</FieldLabel>
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
                    {copy.test}
                  </Button>
                }
              />
              <DialogPortal>
                <DialogBackdrop />
                <DialogViewport>
                  <DialogPopup>
                    <DialogHeader>
                      <DialogTitle>{copy.testTitle}</DialogTitle>
                      <DialogDescription>
                        {copy.testDescription}
                      </DialogDescription>
                    </DialogHeader>

                    <div className="mt-4 grid gap-4">
                      <label className="inline-flex items-center gap-2 text-sm text-foreground">
                        <input
                          checked={sendToSelf}
                          onChange={handleSendToSelfChange}
                          type="checkbox"
                        />
                        {copy.testSelf}
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
                            {copy.testCustom}
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
                            {copy.testClose}
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
                        {isTesting ? copy.testPending : copy.testSubmit}
                      </Button>
                    </DialogFooter>
                  </DialogPopup>
                </DialogViewport>
              </DialogPortal>
            </Dialog>

            <Button disabled={isSaving} type="submit">
              {isSaving ? copy.saving : copy.save}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
