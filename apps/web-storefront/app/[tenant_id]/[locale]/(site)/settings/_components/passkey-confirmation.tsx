"use client";

import type * as ActionForm from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  browserSupportsWebAuthn,
  startAuthentication,
} from "@simplewebauthn/browser";
import type { MouseEvent, ReactNode } from "react";
import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import { useClientMessages } from "#components/client-message";

import type { PasskeyConfirmationStartState } from "../_lib/passkey-confirmation-state";

/** The field the assertion reaches the confirming Action in. */
const CREDENTIAL_FIELD = "passkeyCredential";

/** Whether a browser has WebAuthn does not change while a page is open. */
const subscribeToNothing = () => () => {
  // No teardown: there is no subscription to end.
};

/** The server cannot tell, so the control first renders as if it had none. */
const supportedOnServer = () => false;

interface PasskeyConfirmationContextValue {
  confirm: (event: MouseEvent<HTMLButtonElement>) => void;
  failure: string;
  pending: boolean;
}

const PasskeyConfirmationContext =
  createContext<PasskeyConfirmationContextValue | null>(null);

const usePasskeyConfirmation = (caller: string) => {
  const context = use(PasskeyConfirmationContext);
  if (!context) {
    throw new Error(`${caller} must be rendered inside PasskeyConfirmation.`);
  }
  return context;
};

/**
 * Confirms the form it sits in with one of the reader's passkeys, in place of
 * a password: `begin` asks the API for a challenge, the browser asks the
 * authenticator, and `confirm` sends the form's fields with the assertion as
 * `passkeyCredential`. `confirm` leaves the page when it succeeds, so only a
 * refusal comes back, and it is shown by `PasskeyConfirmationMessage`.
 *
 * The form is submitted by hand rather than through its `action`, which React
 * would reset on every attempt: a closed prompt keeps the addresses the
 * reader typed, and the form's own validation still runs first.
 */
export const PasskeyConfirmation = ({
  begin,
  children,
  confirm,
}: {
  begin: (formData: FormData) => Promise<PasskeyConfirmationStartState>;
  children: ReactNode;
  confirm: (formData: FormData) => Promise<ActionForm.State>;
}) => {
  const t = useClientMessages();
  const [failure, setFailure] = useState("");
  const [pending, startTransition] = useTransition();

  const confirmWithPasskey = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const { form } = event.currentTarget;
      if (!form?.reportValidity()) {
        return;
      }
      const formData = new FormData(form);
      setFailure("");
      startTransition(async () => {
        const started = await begin(formData);
        if (!started.ok) {
          setFailure(started.message);
          return;
        }
        try {
          const credential = await startAuthentication({
            optionsJSON: JSON.parse(started.optionsJson),
          });
          formData.set(CREDENTIAL_FIELD, JSON.stringify(credential));
        } catch (error) {
          // Browsers answer a closed prompt and one that timed out with the
          // same `NotAllowedError`, so the two share a message.
          const name = error instanceof Error ? error.name : "";
          setFailure(
            name === "NotAllowedError" || name === "AbortError"
              ? t("storefront.settings.passkey_confirm_cancelled")
              : t("storefront.settings.passkey_confirm_failed")
          );
          return;
        }
        const result = await confirm(formData);
        if (result && !result.ok) {
          setFailure(result.message);
        }
      });
    },
    [begin, confirm, t]
  );
  const value = useMemo(
    () => ({ confirm: confirmWithPasskey, failure, pending }),
    [confirmWithPasskey, failure, pending]
  );

  return (
    <PasskeyConfirmationContext value={value}>
      {children}
    </PasskeyConfirmationContext>
  );
};

/**
 * The button that confirms with a passkey. A browser without WebAuthn is not
 * offered it, and the server cannot tell, so it appears after hydration.
 */
export const PasskeyConfirmationSubmit = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  const { confirm, pending } = usePasskeyConfirmation(
    "PasskeyConfirmationSubmit"
  );
  const supported = useSyncExternalStore(
    subscribeToNothing,
    browserSupportsWebAuthn,
    supportedOnServer
  );
  if (!supported) {
    return null;
  }

  return (
    <button
      aria-busy={pending || undefined}
      className={className}
      disabled={pending}
      onClick={confirm}
      type="button"
    >
      {children}
    </button>
  );
};

/** Why the last confirmation with a passkey did not go through. */
export const PasskeyConfirmationMessage = () => {
  const { failure } = usePasskeyConfirmation("PasskeyConfirmationMessage");

  return failure ? (
    <FormMessage variant="destructive">{failure}</FormMessage>
  ) : null;
};
