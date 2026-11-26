import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
import * as PasswordInput from "@publira/ui-components/password-input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { ReactElement, ReactNode } from "react";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import type { MyIdentities } from "#lib/auth";
import { SIGN_IN_PROVIDER_NAMES } from "#lib/sign-in-provider";
import type { SignInProvider } from "#lib/sign-in-provider";
import { getTenantSignInClients } from "#lib/tenant";

import * as PasskeyConfirmation from "../../_components/passkey-confirmation";
import { beginPasskeyConfirmationAction } from "../../_lib/passkey-confirmation-actions";
import { SECURITY_SETTINGS_RETURN_TO } from "../_lib/security-path";

/**
 * What the reader can confirm adding or removing a passkey, or unlinking a
 * provider, with: the password of an account that has one, and otherwise one
 * of its passkeys or a fresh sign-in to a linked provider the site can still
 * send the reader to.
 */
export interface Confirmations {
  hasPassword: boolean;
  passkey: boolean;
  providers: SignInProvider[];
}

/**
 * The confirmations `mine` allows. A failed read of the account leaves the
 * password, as it does for the other forms on the page.
 */
export const confirmationsFor = async (
  mine: MyIdentities | null,
  tenantId: string
): Promise<Confirmations> => {
  if (!mine || mine.hasPassword) {
    return { hasPassword: true, passkey: false, providers: [] };
  }

  const clients = await getTenantSignInClients(tenantId);

  return {
    hasPassword: false,
    passkey: mine.hasPasskey,
    providers: mine.identities.flatMap(({ provider }) =>
      clients[provider] ? [provider] : []
    ),
  };
};

export const confirmButtonClassName =
  "inline-flex w-full justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";

/**
 * The dialog a step is confirmed in, opened by `trigger`. A step that
 * succeeds goes back to the page with its outcome, and the row the dialog
 * belongs to changes with it, so the dialog closes itself; one that is refused
 * says why inside it.
 */
export const ConfirmationDialog = ({
  children,
  description,
  title,
  trigger,
}: {
  children: ReactNode;
  description: ReactNode;
  title: ReactNode;
  trigger: ReactElement;
}) => (
  <Dialog.Root>
    <Dialog.Trigger render={trigger} />
    <Dialog.Portal>
      <Dialog.Backdrop />
      <Dialog.Viewport>
        <Dialog.Popup>
          <Dialog.Header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Description>{description}</Dialog.Description>
          </Dialog.Header>
          {children}
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>
);

/** What the dialog's description says to an account without a password. */
export const PasswordlessDescription = ({
  confirmations,
}: {
  confirmations: Confirmations;
}) =>
  confirmations.passkey || confirmations.providers.length > 0 ? (
    <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
      <Message message="storefront.settings.confirm_without_password" />
    </Suspense>
  ) : (
    <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
      <Message message="storefront.settings.confirm_no_method" />
    </Suspense>
  );

/** The account's current password, which the step is confirmed with. */
export const CurrentPasswordField = () => (
  <Field.Root>
    <Field.Label required>
      <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
        <Message message="storefront.settings.current_password_label" />
      </Suspense>
    </Field.Label>
    <Field.Content>
      <PasswordInput.Root>
        <PasswordInput.Control
          autoComplete="current-password"
          name="password"
          placeholder="••••••••"
          required
        />
        <PasswordInput.Toggle>
          <Suspense fallback={null}>
            <Message message="storefront.common.show_password" />
          </Suspense>
        </PasswordInput.Toggle>
      </PasswordInput.Root>
    </Field.Content>
  </Field.Root>
);

export const CancelButton = () => (
  <Dialog.Close
    render={
      <Button type="button" variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="storefront.settings.cancel" />
        </Suspense>
      </Button>
    }
  />
);

/** The button that sends the reader to `provider` to confirm with. */
export const ProviderConfirmButton = ({
  name = "confirmationProvider",
  provider,
}: {
  name?: string;
  provider: SignInProvider;
}) => (
  <button
    className={confirmButtonClassName}
    name={name}
    type="submit"
    value={provider}
  >
    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
      <Message
        message="storefront.settings.confirm_with_provider"
        values={{ provider: SIGN_IN_PROVIDER_NAMES[provider] }}
      />
    </Suspense>
  </button>
);

/**
 * The confirmation of a removal or an unlink: the password, with `submit` as
 * the button that sends it, or one of the account's passkeys and its linked
 * providers. `fields` are the hidden fields naming what the step acts on, sent
 * with every one of them.
 */
export const StepConfirmation = ({
  confirmations,
  fields,
  passkeyAction,
  passwordAction,
  providerAction,
  providerField,
  submit,
}: {
  confirmations: Confirmations;
  fields: ReactNode;
  passkeyAction: (formData: FormData) => Promise<ActionForm.State>;
  passwordAction: (
    previousState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>;
  providerAction: (formData: FormData) => Promise<void>;
  /** The field the provider to sign in again with is sent as. */
  providerField?: string;
  submit: ReactNode;
}) => {
  if (confirmations.hasPassword) {
    return (
      <ActionForm.Root action={passwordAction} className="grid gap-4">
        <LocaleField />
        {fields}
        <ActionForm.Fieldset>
          <CurrentPasswordField />
        </ActionForm.Fieldset>
        <Dialog.Footer>
          <CancelButton />
          <ActionForm.Submit variant="destructive">{submit}</ActionForm.Submit>
        </Dialog.Footer>
      </ActionForm.Root>
    );
  }

  return (
    <div className="grid gap-3">
      {confirmations.passkey ? (
        <form className="grid gap-3">
          <LocaleField />
          {fields}
          <input
            name="returnTo"
            type="hidden"
            value={SECURITY_SETTINGS_RETURN_TO}
          />
          <PasskeyConfirmation.Root
            begin={beginPasskeyConfirmationAction}
            confirm={passkeyAction}
          >
            <PasskeyConfirmation.Submit className={confirmButtonClassName}>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="storefront.settings.confirm_with_passkey" />
              </Suspense>
            </PasskeyConfirmation.Submit>
            <PasskeyConfirmation.Message />
          </PasskeyConfirmation.Root>
        </form>
      ) : null}
      {confirmations.providers.length > 0 ? (
        <form action={providerAction} className="grid gap-3">
          <LocaleField />
          {fields}
          {confirmations.providers.map((provider) => (
            <ProviderConfirmButton
              key={provider}
              name={providerField}
              provider={provider}
            />
          ))}
        </form>
      ) : null}
      <Dialog.Footer>
        <CancelButton />
      </Dialog.Footer>
    </div>
  );
};
