"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import type { ChangeEvent } from "react";
import {
  useActionState,
  useCallback,
  useContext,
  useId,
  useState,
} from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "#lib/email-settings-shared";
import type { TenantSmtpSettings } from "#lib/email-settings-shared";
import { useTenantId } from "#lib/use-tenant-id";

import type {
  TenantEmailSettingsFormState,
  TenantSmtpTestFormState,
} from "../settings-types";

const encryptionOptions = (messages: SharedMessages) =>
  [
    { label: "TLS", value: "tls" },
    { label: "STARTTLS", value: "starttls" },
    {
      label: getMessage(messages, "admin.settings.email.encryption_none"),
      value: "none",
    },
  ] as const;

interface TenantEmailSettingsFormProps {
  initialSettings: TenantSmtpSettings;
  loadErrorMessage?: string;
  canEdit: boolean;
  tenantName: string;
  saveAction: (
    prevState: TenantEmailSettingsFormState,
    formData: FormData
  ) => Promise<TenantEmailSettingsFormState>;
  testAction: (
    prevState: TenantSmtpTestFormState,
    formData: FormData
  ) => Promise<TenantSmtpTestFormState>;
}

interface PasswordFieldSectionProps {
  fieldsInteractive: boolean;
  hasStoredPassword: boolean;
  isPasswordEditing: boolean;
  onCancelPasswordEdit: () => void;
  onStartPasswordEdit: () => void;
}

const PasswordFieldSection = ({
  fieldsInteractive,
  hasStoredPassword,
  isPasswordEditing,
  onCancelPasswordEdit,
  onStartPasswordEdit,
}: PasswordFieldSectionProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);

  return (
    <Field>
      <FieldLabel required={fieldsInteractive && isPasswordEditing}>
        {getMessage(messages, "admin.settings.email.password")}
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
              disabled={!fieldsInteractive}
              onClick={onStartPasswordEdit}
              type="button"
              variant="outline"
            >
              {getMessage(messages, "admin.settings.email.password_change")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Input
              autoComplete="new-password"
              disabled={!fieldsInteractive}
              key="password-editable"
              name="password"
              required={fieldsInteractive && isPasswordEditing}
              type="password"
            />
            {hasStoredPassword ? (
              <Button
                disabled={!fieldsInteractive}
                onClick={onCancelPasswordEdit}
                type="button"
                variant="outline"
              >
                {getMessage(
                  messages,
                  "admin.settings.email.password_change_cancel"
                )}
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
  );
};

interface SmtpTestDialogProps {
  dialogOpen: boolean;
  formId: string;
  isTesting: boolean;
  sendToSelf: boolean;
  onDialogOpenChange: (open: boolean) => void;
  onSendToSelfChange: (checked: boolean) => void;
  testFormAction: (formData: FormData) => void;
  testState: TenantSmtpTestFormState;
  canEdit: boolean;
}

const SmtpTestDialog = ({
  dialogOpen,
  formId,
  isTesting,
  sendToSelf,
  onDialogOpenChange,
  onSendToSelfChange,
  testFormAction,
  testState,
  canEdit,
}: SmtpTestDialogProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const handleSendToSelfChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onSendToSelfChange(event.target.checked);
    },
    [onSendToSelfChange]
  );

  return (
    <Dialog onOpenChange={onDialogOpenChange} open={dialogOpen}>
      <DialogTrigger
        render={
          <Button disabled={!canEdit} type="button" variant="outline">
            {getMessage(messages, "admin.settings.email.test")}
          </Button>
        }
      />
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>
                {getMessage(messages, "admin.settings.email.test_title")}
              </DialogTitle>
              <DialogDescription>
                {getMessage(messages, "admin.settings.email.test_description")}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 grid gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-foreground">
                <input
                  checked={sendToSelf}
                  onChange={handleSendToSelfChange}
                  type="checkbox"
                />
                {getMessage(messages, "admin.settings.email.test_send_to_self")}
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
                  <FieldLabel required>
                    {getMessage(
                      messages,
                      "admin.settings.email.test_recipient"
                    )}
                  </FieldLabel>
                  <FieldContent>
                    <Input
                      form={formId}
                      name="recipient_email"
                      placeholder="recipient@example.com"
                      required={!sendToSelf}
                      type="email"
                    />
                  </FieldContent>
                </Field>
              )}

              {testState ? (
                <FormMessage variant={testState.ok ? "success" : "destructive"}>
                  {testState.message}
                </FormMessage>
              ) : null}
            </div>

            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="outline">
                    {getMessage(messages, "admin.settings.email.close")}
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
                {isTesting
                  ? getMessage(messages, "admin.settings.email.test_sending")
                  : getMessage(messages, "admin.settings.email.test_submit")}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  );
};

export const TenantEmailSettingsForm = ({
  initialSettings,
  loadErrorMessage,
  canEdit,
  tenantName,
  saveAction,
  testAction,
}: TenantEmailSettingsFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
  const formId = useId();
  const smtpOverrideId = useId();
  const [saveState, saveFormAction, isSaving] = useActionState(
    saveAction,
    null
  );
  const [testState, testFormAction, isTesting] = useActionState(
    testAction,
    null
  );

  const [smtpOverrideEnabled, setSmtpOverrideEnabled] = useState(
    initialSettings.smtpOverrideEnabled
  );
  const [hasStoredPassword, setHasStoredPassword] = useState(
    initialSettings.hasPassword
  );
  const [isPasswordEditing, setIsPasswordEditing] = useState(
    !initialSettings.hasPassword
  );
  const [sendToSelf, setSendToSelf] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prevHasPassword, setPrevHasPassword] = useState(
    initialSettings.hasPassword
  );
  const [prevSmtpOverrideEnabled, setPrevSmtpOverrideEnabled] = useState(
    initialSettings.smtpOverrideEnabled
  );
  const [prevSaveState, setPrevSaveState] = useState(saveState);

  if (
    initialSettings.hasPassword !== prevHasPassword ||
    initialSettings.smtpOverrideEnabled !== prevSmtpOverrideEnabled
  ) {
    setPrevHasPassword(initialSettings.hasPassword);
    setPrevSmtpOverrideEnabled(initialSettings.smtpOverrideEnabled);
    setSmtpOverrideEnabled(initialSettings.smtpOverrideEnabled);
    setHasStoredPassword(initialSettings.hasPassword);
    setIsPasswordEditing(!initialSettings.hasPassword);
  }

  if (saveState !== prevSaveState) {
    setPrevSaveState(saveState);
    if (saveState?.ok) {
      setSmtpOverrideEnabled(saveState.settings.smtpOverrideEnabled);
      setHasStoredPassword(saveState.settings.hasPassword);
      setIsPasswordEditing(!saveState.settings.hasPassword);
    }
  }

  const fieldsInteractive = canEdit && smtpOverrideEnabled;

  const handleOverrideChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setSmtpOverrideEnabled(event.target.checked);
    },
    []
  );

  const handleStartPasswordEdit = useCallback(() => {
    setIsPasswordEditing(true);
  }, []);

  const handleCancelPasswordEdit = useCallback(() => {
    setIsPasswordEditing(false);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "admin.settings.email.title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "admin.settings.email.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={saveFormAction}
          className="grid gap-5 sm:max-w-3xl"
          id={formId}
        >
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel htmlFor={smtpOverrideId}>
              {getMessage(messages, "admin.settings.email.override")}
            </FieldLabel>
            <FieldContent>
              <label className="inline-flex items-center gap-2 text-sm text-foreground">
                <input
                  checked={smtpOverrideEnabled}
                  disabled={!canEdit}
                  id={smtpOverrideId}
                  name="smtp_override_enabled"
                  onChange={handleOverrideChange}
                  type="checkbox"
                />
                {getMessage(messages, "admin.settings.email.override_checkbox")}
              </label>
              <FieldDescription>
                {getMessage(
                  messages,
                  "admin.settings.email.override_description"
                )}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required={fieldsInteractive}>
              {getMessage(messages, "admin.settings.email.host")}
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={initialSettings.host}
                disabled={!fieldsInteractive}
                name="host"
                placeholder="smtp.example.com"
                required={fieldsInteractive}
                type="text"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required={fieldsInteractive}>
              {getMessage(messages, "admin.settings.email.port")}
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={String(initialSettings.port || 587)}
                disabled={!fieldsInteractive}
                max={65_535}
                min={1}
                name="port"
                required={fieldsInteractive}
                type="number"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required={fieldsInteractive}>
              {getMessage(messages, "admin.settings.email.username")}
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={initialSettings.username}
                disabled={!fieldsInteractive}
                name="username"
                required={fieldsInteractive}
                type="text"
              />
            </FieldContent>
          </Field>

          <PasswordFieldSection
            fieldsInteractive={fieldsInteractive}
            hasStoredPassword={hasStoredPassword}
            isPasswordEditing={isPasswordEditing}
            onCancelPasswordEdit={handleCancelPasswordEdit}
            onStartPasswordEdit={handleStartPasswordEdit}
          />

          <Field>
            <FieldLabel required={fieldsInteractive}>
              {getMessage(messages, "admin.settings.email.encryption")}
            </FieldLabel>
            <FieldContent>
              <Select
                defaultValue={initialSettings.encryption || "starttls"}
                disabled={!fieldsInteractive}
                items={encryptionOptions(messages)}
                name="encryption"
                required={fieldsInteractive}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.settings.email.from_name")}
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={initialSettings.fromName}
                disabled={!fieldsInteractive}
                name="from_name"
                placeholder={
                  tenantName ||
                  getMessage(
                    messages,
                    "admin.settings.email.from_name_fallback"
                  )
                }
                type="text"
              />
              <FieldDescription>
                {getMessage(
                  messages,
                  "admin.settings.email.from_name_description"
                )}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel required={fieldsInteractive}>
              {getMessage(messages, "admin.settings.email.from_address")}
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={initialSettings.fromAddress}
                disabled={!fieldsInteractive}
                name="from_address"
                placeholder="noreply@example.com"
                required={fieldsInteractive}
                type="email"
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.settings.email.reply_to")}
            </FieldLabel>
            <FieldContent>
              <Input
                defaultValue={initialSettings.replyTo}
                disabled={!fieldsInteractive}
                name="reply_to"
                placeholder="support@example.com"
                type="email"
              />
            </FieldContent>
          </Field>

          {canEdit ? null : (
            <FormMessage variant="destructive">
              {getMessage(messages, "admin.settings.admin_only")}
            </FormMessage>
          )}

          {loadErrorMessage ? (
            <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
          ) : null}

          {saveState ? (
            <FormMessage variant={saveState.ok ? "success" : "destructive"}>
              {saveState.message}
            </FormMessage>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <SmtpTestDialog
              canEdit={canEdit}
              dialogOpen={dialogOpen}
              formId={formId}
              isTesting={isTesting}
              onDialogOpenChange={setDialogOpen}
              onSendToSelfChange={setSendToSelf}
              sendToSelf={sendToSelf}
              testFormAction={testFormAction}
              testState={testState}
            />

            <Button disabled={!canEdit || isSaving} type="submit">
              {isSaving
                ? getMessage(messages, "admin.settings.saving")
                : getMessage(messages, "admin.settings.save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
