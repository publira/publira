"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { StatusChip } from "@publira/ui-components/badge";
import type { BadgeTone } from "@publira/ui-components/badge";
import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Fieldset } from "@publira/ui-components/fieldset";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import type { ChangeEvent, ReactNode } from "react";
import {
  useActionState,
  useCallback,
  useContext,
  useId,
  useState,
} from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage, useClientMessages } from "#components/client-message";
import { paymentSettingsStatus } from "#lib/payment-settings-shared";
import type {
  PaymentSettingsStatus,
  TenantPaymentSettings,
} from "#lib/payment-settings-shared";
import { useTenantId } from "#lib/use-tenant-id";

import type { TenantPaymentSettingsFormState } from "../payment-types";

const statusTone: Record<PaymentSettingsStatus, BadgeTone> = {
  disabled: "muted",
  incomplete: "warning",
  ready: "success",
  unset: "muted",
};

const PaymentStatusLabel = ({ status }: { status: PaymentSettingsStatus }) => {
  switch (status) {
    case "disabled": {
      return <ClientMessage message="admin.settings.payment.status.disabled" />;
    }
    case "incomplete": {
      return (
        <ClientMessage message="admin.settings.payment.status.incomplete" />
      );
    }
    case "ready": {
      return <ClientMessage message="admin.settings.payment.status.ready" />;
    }
    default: {
      return <ClientMessage message="admin.settings.payment.status.unset" />;
    }
  }
};

const PaymentStatusDescription = ({
  status,
}: {
  status: PaymentSettingsStatus;
}) => {
  switch (status) {
    case "disabled": {
      return (
        <ClientMessage message="admin.settings.payment.status.disabled_description" />
      );
    }
    case "incomplete": {
      return (
        <ClientMessage message="admin.settings.payment.status.incomplete_description" />
      );
    }
    case "ready": {
      return (
        <ClientMessage message="admin.settings.payment.status.ready_description" />
      );
    }
    default: {
      return (
        <ClientMessage message="admin.settings.payment.status.unset_description" />
      );
    }
  }
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
  /** The field's label. */
  children: ReactNode;
  configured: boolean;
  error?: string;
  hint: string;
  name: string;
  required: boolean;
}

const PaymentSecretField = ({
  canEdit,
  children,
  configured,
  error,
  hint,
  name,
  required,
}: PaymentSecretFieldProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useClientMessages();
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
        {children}
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
                {t("admin.settings.payment.secret_change_cancel")}
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
              {t("admin.settings.payment.secret_change")}
            </Button>
          </div>
        )}
        {error ? (
          <FormMessage variant="destructive">{error}</FormMessage>
        ) : null}
      </FieldContent>
      <FieldDescription>
        {t("admin.settings.payment.secret_description")}
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
  const tenantId = useTenantId();
  const enabledId = useId();
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
  const enabled = enabledOverride ?? settings.enabled;
  const status = paymentSettingsStatus(settings);
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
            <PaymentStatusLabel status={status} />
          </StatusChip>
          <p className="text-sm text-muted-foreground">
            <PaymentStatusDescription status={status} />
          </p>
        </div>
      )}

      <Field>
        <FieldLabel>
          <ClientMessage message="admin.settings.payment.provider" />
        </FieldLabel>
        <FieldContent>
          <Input disabled readOnly type="text" value="Stripe" />
          <FieldDescription>
            <ClientMessage message="admin.settings.payment.provider_description" />
          </FieldDescription>
        </FieldContent>
      </Field>

      <Fieldset className="grid gap-5" disabled={isSaving}>
        <Field>
          <FieldLabel htmlFor={enabledId}>
            <ClientMessage message="admin.settings.payment.enabled" />
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
              <ClientMessage message="admin.settings.payment.enabled_checkbox" />
            </label>
            <FieldDescription>
              <ClientMessage message="admin.settings.payment.enabled_description" />
            </FieldDescription>
          </FieldContent>
        </Field>

        <PaymentSecretField
          canEdit={!fieldsDisabled}
          configured={settings.secretKeyConfigured}
          error={fieldErrors?.secretKey}
          hint={settings.secretKeyHint}
          name="secret_key"
          required={secretKeyRequired}
        >
          <ClientMessage message="admin.settings.payment.secret_key" />
        </PaymentSecretField>

        <PaymentSecretField
          canEdit={!fieldsDisabled}
          configured={settings.webhookSecretConfigured}
          error={fieldErrors?.webhookSecret}
          hint={settings.webhookSecretHint}
          name="webhook_secret"
          required={webhookSecretRequired}
        >
          <ClientMessage message="admin.settings.payment.webhook_secret" />
        </PaymentSecretField>
      </Fieldset>

      {webhookUrl ? (
        <Field>
          <FieldLabel>
            <ClientMessage message="admin.settings.payment.webhook_url" />
          </FieldLabel>
          <FieldContent>
            <Input disabled readOnly type="text" value={webhookUrl} />
            <FieldDescription>
              <ClientMessage message="admin.settings.payment.webhook_url_description" />
            </FieldDescription>
            <FieldDescription>
              <ClientMessage message="admin.settings.payment.webhook_url_legacy_description" />
            </FieldDescription>
          </FieldContent>
        </Field>
      ) : null}

      {canEdit ? null : (
        <FormMessage variant="destructive">
          <ClientMessage message="admin.settings.admin_only" />
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
          <ActionFormIdle>
            <ClientMessage message="admin.settings.save" />
          </ActionFormIdle>
          <ActionFormPending>
            <ClientMessage message="admin.settings.saving" />
          </ActionFormPending>
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
  const t = useClientMessages();
  const [saveState, saveFormAction, isSaving] = useActionState(action, null);
  const settings = saveState?.ok ? saveState.settings : initialSettings;

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            {t("admin.settings.payment.title")}
          </AdminSectionTitle>
          <AdminSectionDescription>
            {t("admin.settings.payment.description")}
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
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
    </AdminSection>
  );
};
