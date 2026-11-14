"use client";

import * as Field from "@publira/ui-components/field";
import { RadioGroup } from "@publira/ui-components/radio-group";
import { createContext, use, useMemo } from "react";
import type { ReactNode } from "react";

import { useClientMessages } from "#components/client-message";
import type { StorefrontClientMessageKey } from "#lib/messages";
import type { PaymentProviderOption } from "#lib/payment-providers";
import { useWebStorage, writeWebStorage } from "#lib/web-storage";

/**
 * Per-tenant key: the public site serves every tenant from one origin, and the
 * providers one tenant sells through are not another's.
 */
const storageKey = (tenantId: string): string =>
  `publira.payment-provider.${tenantId}`;

interface PaymentProviderChoiceValue {
  choose: (id: string) => void;
  chosen: string;
  providers: readonly PaymentProviderOption[];
}

const PaymentProviderChoiceContext =
  createContext<PaymentProviderChoiceValue | null>(null);

/**
 * The provider the checkouts inside it pay through, which the reader chooses
 * with {@link Picker} and every checkout form posts with {@link Input}. The
 * picker and the forms sit apart, so the choice is shared through context
 * rather than through a common form.
 *
 * The choice is remembered by this browser for the tenant, so the next
 * purchase starts on the provider the reader used last, on this page and on
 * any other; one the tenant no longer sells through falls back to its first.
 * The server render and hydration start on the first, and the remembered one
 * applies right after.
 *
 * With one provider, or none, there is nothing to choose: the picker and the
 * fields render nothing, and the API sends each checkout to the one provider.
 */
export const Root = ({
  children,
  providers,
  tenantId,
}: {
  children: ReactNode;
  providers: readonly PaymentProviderOption[];
  tenantId: string;
}) => {
  const key = storageKey(tenantId);
  const stored = useWebStorage("local", key);

  const value = useMemo<PaymentProviderChoiceValue | null>(() => {
    const [first] = providers;

    if (!first || providers.length < 2) {
      return null;
    }

    return {
      choose: (id) => writeWebStorage("local", key, id),
      chosen: providers.find(({ id }) => id === stored)?.id ?? first.id,
      providers,
    };
  }, [key, providers, stored]);

  return (
    <PaymentProviderChoiceContext value={value}>
      {children}
    </PaymentProviderChoiceContext>
  );
};

/**
 * What a provider is known to take, for the line under its name. A provider
 * this site does not know, such as one an operator added in a fork, is named
 * alone.
 */
const providerMethodsKey = (id: string): StorefrontClientMessageKey | null => {
  switch (id) {
    case "payjp": {
      return "storefront.payment_provider.methods.payjp";
    }

    case "stripe": {
      return "storefront.payment_provider.methods.stripe";
    }

    default: {
      return null;
    }
  }
};

const ProviderOptions = ({
  choice: { choose, chosen, providers },
}: {
  choice: PaymentProviderChoiceValue;
}) => {
  const t = useClientMessages();

  return (
    <Field.Root className="w-full max-w-sm text-left">
      <Field.Label>{t("storefront.payment_provider.label")}</Field.Label>
      <Field.Content>
        <RadioGroup
          items={providers.map(({ displayName, id }) => {
            const methods = providerMethodsKey(id);

            return {
              description: methods ? t(methods) : undefined,
              label: displayName,
              value: id,
            };
          })}
          onValueChange={(id) => choose(id)}
          value={chosen}
        />
      </Field.Content>
    </Field.Root>
  );
};

/**
 * **Pay with**: one option per provider, named by its display name and what it
 * is known to take. Nothing at all where there is no choice to make.
 */
export const Picker = () => {
  const choice = use(PaymentProviderChoiceContext);

  return choice ? <ProviderOptions choice={choice} /> : null;
};

/**
 * The `provider` a checkout form posts: the one chosen with {@link Picker}.
 * Nothing where there is no choice, which the API reads as the one provider.
 */
export const Input = () => {
  const choice = use(PaymentProviderChoiceContext);

  return choice ? (
    <input name="provider" type="hidden" value={choice.chosen} />
  ) : null;
};
