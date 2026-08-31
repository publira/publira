"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { StatusChip } from "@publira/ui-components/badge";
import type { BadgeTone } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import type { ChangeEvent } from "react";
import {
  useActionState,
  useCallback,
  useContext,
  useId,
  useState,
} from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import type { AdminMessageKey } from "#lib/locale";
import {
  paymentSettingsStatus,
  paymentSettingsStatusCopy,
} from "#lib/payment-settings-shared";
import type { TenantPaymentSettings } from "#lib/payment-settings-shared";
import { useTenantId } from "#lib/use-tenant-id";

import type { TenantPaymentSettingsFormState } from "../settings-types";

const statusTone: Record<
  ReturnType<typeof paymentSettingsStatus>,
  BadgeTone
> = {
  disabled: "muted",
  incomplete: "warning",
  ready: "success",
  unset: "muted",
};

interface TenantPaymentSettingsFormProps {
  action: (
    prevState: TenantPaymentSettingsFormState,
    formData: FormData
  ) => Promise<TenantPaymentSettingsFormState>;
  canEdit: boolean;
  initialSettings: TenantPaymentSettings;
  loadErrorMessage?: string;
  webhookUrl?: string;
}

interface PaymentSecretFieldProps {
  canEdit: boolean;
  configured: boolean;
  error?: string;
  hint: string;
  labelKey: AdminMessageKey;
  name: string;
  required: boolean;
}

const PaymentSecretField = ({
  canEdit,
  configured,
  error,
  hint,
  labelKey,
  name,
  required,
}: PaymentSecretFieldProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const inputId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const showInput = !configured || isEditing;

  const handleStartEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  return (
    <Field>
      <FieldLabel htmlFor={inputId} required={canEdit && required && showInput}>
        {getMessage(messages, labelKey)}
      </FieldLabel>
      <FieldContent>
        {showInput ? (
          <div className="flex flex-wrap items-center gap-3" key="secret-edit">
            <Input
              autoComplete="off"
              disabled={!canEdit}
              id={inputId}
              name={name}
              required={canEdit && required}
              type="password"
            />
            {configured ? (
              <Button
                disabled={!canEdit}
                onClick={handleCancelEdit}
                type="button"
                variant="outline"
              >
                {getMessage(
                  messages,
                  "admin.settings.payment.secret_change_cancel"
                )}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3" key="secret-hint">
            <Input disabled id={inputId} readOnly type="text" value={hint} />
            <Button
              disabled={!canEdit}
              onClick={handleStartEdit}
              type="button"
              variant="outline"
            >
              {getMessage(messages, "admin.settings.payment.secret_change")}
            </Button>
          </div>
        )}
        {error ? (
          <FormMessage variant="destructive">{error}</FormMessage>
        ) : null}
      </FieldContent>
      <FieldDescription>
        {getMessage(messages, "admin.settings.payment.secret_description")}
      </FieldDescription>
    </Field>
  );
};

interface PaymentSettingsFieldsProps {
  canEdit: boolean;
  isSaving: boolean;
  loadErrorMessage?: string;
  saveFormAction: (formData: FormData) => void;
  saveState: TenantPaymentSettingsFormState;
  settings: TenantPaymentSettings;
  webhookUrl?: string;
}

const PaymentSettingsFields = ({
  canEdit,
  isSaving,
  loadErrorMessage,
  saveFormAction,
  saveState,
  settings,
  webhookUrl,
}: PaymentSettingsFieldsProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
  const enabledId = useId();
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
  const enabled = enabledOverride ?? settings.enabled;
  const status = paymentSettingsStatus(settings);
  const statusCopy = paymentSettingsStatusCopy[status];
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);
  const fieldErrors =
    saveState && !saveState.ok ? saveState.fieldErrors : undefined;
  const secretKeyRequired = enabled && !settings.secretKeyConfigured;
  const webhookSecretRequired = enabled && !settings.webhookSecretConfigured;

  const handleEnabledChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setEnabledOverride(event.target.checked);
    },
    []
  );

  return (
    <form action={saveFormAction} className="grid gap-5 sm:max-w-3xl">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input
        name="secret_key_configured"
        type="hidden"
        value={settings.secretKeyConfigured ? "1" : "0"}
      />
      <input
        name="webhook_secret_configured"
        type="hidden"
        value={settings.webhookSecretConfigured ? "1" : "0"}
      />

      {loadErrorMessage ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <StatusChip status={statusTone[status]}>
            {getMessage(messages, statusCopy.labelKey)}
          </StatusChip>
          <p className="text-sm text-muted-foreground">
            {getMessage(messages, statusCopy.descriptionKey)}
          </p>
        </div>
      )}

      <Field>
        <FieldLabel>
          {getMessage(messages, "admin.settings.payment.provider")}
        </FieldLabel>
        <FieldContent>
          <Input disabled readOnly type="text" value="Stripe" />
          <FieldDescription>
            {getMessage(
              messages,
              "admin.settings.payment.provider_description"
            )}
          </FieldDescription>
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor={enabledId}>
          {getMessage(messages, "admin.settings.payment.enabled")}
        </FieldLabel>
        <FieldContent>
          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              checked={enabled}
              disabled={fieldsDisabled}
              id={enabledId}
              name="enabled"
              onChange={handleEnabledChange}
              type="checkbox"
            />
            {getMessage(messages, "admin.settings.payment.enabled_checkbox")}
          </label>
          <FieldDescription>
            {getMessage(messages, "admin.settings.payment.enabled_description")}
          </FieldDescription>
        </FieldContent>
      </Field>

      <PaymentSecretField
        canEdit={!fieldsDisabled}
        configured={settings.secretKeyConfigured}
        error={fieldErrors?.secretKey}
        hint={settings.secretKeyHint}
        labelKey="admin.settings.payment.secret_key"
        name="secret_key"
        required={secretKeyRequired}
      />

      <PaymentSecretField
        canEdit={!fieldsDisabled}
        configured={settings.webhookSecretConfigured}
        error={fieldErrors?.webhookSecret}
        hint={settings.webhookSecretHint}
        labelKey="admin.settings.payment.webhook_secret"
        name="webhook_secret"
        required={webhookSecretRequired}
      />

      {webhookUrl ? (
        <Field>
          <FieldLabel>
            {getMessage(messages, "admin.settings.payment.webhook_url")}
          </FieldLabel>
          <FieldContent>
            <Input disabled readOnly type="text" value={webhookUrl} />
            <FieldDescription>
              {getMessage(
                messages,
                "admin.settings.payment.webhook_url_description"
              )}
            </FieldDescription>
          </FieldContent>
        </Field>
      ) : null}

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
        <Button disabled={fieldsDisabled || isSaving} type="submit">
          {isSaving
            ? getMessage(messages, "admin.settings.saving")
            : getMessage(messages, "admin.settings.save")}
        </Button>
      </div>
    </form>
  );
};

export const TenantPaymentSettingsForm = ({
  action,
  canEdit,
  initialSettings,
  loadErrorMessage,
  webhookUrl,
}: TenantPaymentSettingsFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const [saveState, saveFormAction, isSaving] = useActionState(action, null);
  const settings = saveState?.ok ? saveState.settings : initialSettings;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "admin.settings.payment.title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "admin.settings.payment.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PaymentSettingsFields
          canEdit={canEdit}
          isSaving={isSaving}
          key={[
            settings.enabled,
            settings.ready,
            settings.secretKeyConfigured,
            settings.secretKeyHint,
            settings.webhookSecretConfigured,
            settings.webhookSecretHint,
          ].join(":")}
          loadErrorMessage={loadErrorMessage}
          saveFormAction={saveFormAction}
          saveState={saveState}
          settings={settings}
          webhookUrl={webhookUrl}
        />
      </CardContent>
    </Card>
  );
};
