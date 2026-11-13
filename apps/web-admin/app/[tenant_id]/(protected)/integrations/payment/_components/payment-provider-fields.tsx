import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { currencyDisplayName } from "@publira/utils";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";
import * as ProviderCredential from "#components/provider-credential";
import * as ProviderEnabled from "#components/provider-enabled";
import {
  ProviderSecretControls,
  ProviderSecretDescription,
} from "#components/provider-secret-controls";
import type {
  PaymentCredentialField,
  PaymentCredentialFieldState,
  PaymentProvider,
} from "#lib/payment-settings-shared";

/**
 * A credential's name in the console's own catalogs. A field no catalog names
 * yet shows the name the provider declares it under.
 */
const PaymentCredentialName = ({
  field,
  provider,
}: {
  field: string;
  provider: string;
}) => {
  switch (`${provider}.${field}`) {
    case "stripe.secret_key": {
      return (
        <Message message="admin.settings.payment.fields.stripe.secret_key" />
      );
    }

    case "stripe.webhook_secret": {
      return (
        <Message message="admin.settings.payment.fields.stripe.webhook_secret" />
      );
    }

    case "payjp.secret_key": {
      return (
        <Message message="admin.settings.payment.fields.payjp.secret_key" />
      );
    }

    case "payjp.webhook_token": {
      return (
        <Message message="admin.settings.payment.fields.payjp.webhook_token" />
      );
    }

    default: {
      return field;
    }
  }
};

/** Where in the provider's own dashboard a credential is found. */
const PaymentCredentialSource = ({
  field,
  provider,
}: {
  field: string;
  provider: string;
}) => {
  switch (`${provider}.${field}`) {
    case "payjp.secret_key": {
      return (
        <Field.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="admin.settings.payment.field_sources.payjp.secret_key" />
          </Suspense>
        </Field.Description>
      );
    }

    case "payjp.webhook_token": {
      return (
        <Field.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
            <Message message="admin.settings.payment.field_sources.payjp.webhook_token" />
          </Suspense>
        </Field.Description>
      );
    }

    default: {
      return null;
    }
  }
};

/** What a provider's webhook URL block adds for that provider alone. */
const PaymentWebhookNote = ({ provider }: { provider: string }) => {
  if (provider !== "payjp") {
    return null;
  }

  return (
    <Field.Description>
      <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
        <Message message="admin.settings.payment.webhook_url_payjp_description" />
      </Suspense>
    </Field.Description>
  );
};

const PaymentCredentialDescription = ({
  field,
}: {
  field: PaymentCredentialField;
}) => {
  if (field.secret) {
    return <ProviderSecretDescription />;
  }

  if (field.public) {
    return (
      <Field.Description>
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="admin.settings.payment.public_description" />
        </Suspense>
      </Field.Description>
    );
  }

  return null;
};

/**
 * The currency the tenant sells in, chosen among `currencies`. It starts on
 * `currency` where it is one of them, and on the first of them otherwise, which
 * a save then asks for. Once a purchase locks it the select is disabled, so the
 * form posts no currency and the stored one is kept.
 */
export const PaymentCurrencyField = ({
  currencies,
  currency,
  description,
  locale,
  locked,
}: {
  currencies: readonly string[];
  currency: string;
  /** What the select offers, shown while the currency is not locked. */
  description: ReactNode;
  locale: Locale;
  locked: boolean;
}) => (
  <Field.Root>
    <Field.Label>
      <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
        <Message message="admin.settings.payment.currency" />
      </Suspense>
    </Field.Label>
    <Field.Content>
      <Select
        defaultValue={currencies.includes(currency) ? currency : currencies[0]}
        disabled={locked}
        items={currencies.map((code) => ({
          label: `${currencyDisplayName(code, { locale })} (${code})`,
          value: code,
        }))}
        name="currency"
      />
      <ActionForm.FieldError name="currency" />
      <Field.Description>
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          {locked ? (
            <Message message="admin.settings.payment.currency_locked" />
          ) : (
            description
          )}
        </Suspense>
      </Field.Description>
    </Field.Content>
  </Field.Root>
);

/** The checkbox that turns payments through the provider on. */
export const PaymentEnabledField = ({
  description,
}: {
  /** What is left undone while it is off. */
  description: ReactNode;
}) => (
  <Field.Root>
    <Field.Label>
      <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
        <Message message="admin.settings.payment.enabled" />
      </Suspense>
    </Field.Label>
    <Field.Content>
      <ProviderEnabled.Checkbox>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.settings.payment.enabled_checkbox" />
        </Suspense>
      </ProviderEnabled.Checkbox>
      <Field.Description>
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          {description}
        </Suspense>
      </Field.Description>
    </Field.Content>
  </Field.Root>
);

/**
 * One field per credential `provider` declares, each behind what is stored for
 * it. Rendered inside `ProviderEnabled.Root`, which says which are required.
 */
export const PaymentCredentialFields = ({
  disabled,
  provider,
  stored,
}: {
  disabled: boolean;
  provider: PaymentProvider;
  /** What is stored for the provider's fields; empty for one not saved yet. */
  stored: readonly PaymentCredentialFieldState[];
}) =>
  provider.fields.map((field) => {
    const state = stored.find((candidate) => candidate.name === field.name);

    return (
      <ProviderCredential.Root
        configured={Boolean(state?.configured)}
        disabled={disabled}
        hint={state?.hint ?? ""}
        key={field.name}
        name={field.name}
        required={field.required}
      >
        <Field.Root>
          <ProviderCredential.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <PaymentCredentialName
                field={field.name}
                provider={provider.id}
              />
            </Suspense>
          </ProviderCredential.Label>
          <Field.Content>
            {field.secret ? (
              <ProviderSecretControls
                configured={Boolean(state?.configured)}
                required={field.required}
              />
            ) : (
              <ProviderCredential.TextInput />
            )}
            <ActionForm.FieldError name={`credential_${field.name}`} />
          </Field.Content>
          <PaymentCredentialSource field={field.name} provider={provider.id} />
          <PaymentCredentialDescription field={field} />
        </Field.Root>
      </ProviderCredential.Root>
    );
  });

/** The URL to register with `provider` as where it sends its notifications. */
export const PaymentWebhookUrlField = ({
  provider,
  webhookOrigin,
}: {
  provider: PaymentProvider;
  webhookOrigin: string;
}) => (
  <Field.Root>
    <Field.Label>
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <Message message="admin.settings.payment.webhook_url" />
      </Suspense>
    </Field.Label>
    <Field.Content>
      <Input
        disabled
        readOnly
        type="text"
        value={`${webhookOrigin}${provider.webhookPath}`}
      />
      <Field.Description>
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message
            message="admin.settings.payment.webhook_url_description"
            values={{ provider: provider.displayName }}
          />
        </Suspense>
      </Field.Description>
      <PaymentWebhookNote provider={provider.id} />
    </Field.Content>
  </Field.Root>
);
