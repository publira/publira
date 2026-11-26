"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { createContext, use, useState, useSyncExternalStore } from "react";
import type { Dispatch, ReactNode } from "react";

import { useClientMessages } from "#components/client-message";
import type { StorefrontClientMessageAccessor } from "#lib/messages";

import { beginPasskeyConfirmationAction } from "../../_lib/passkey-confirmation-actions";
import {
  beginPasskeyRegistrationAction,
  beginPendingPasskeyRegistrationAction,
  finishPasskeyRegistrationAction,
  namePasskeyAction,
} from "../_lib/passkey-actions";
import type { PasskeyRegistrationState } from "../_lib/passkey-state";

/** Whether a browser has WebAuthn does not change while a page is open. */
const subscribeToNothing = () => () => {
  // No teardown: there is no subscription to end.
};

/** The server cannot tell, so the control first renders as if it had none. */
const supportedOnServer = () => false;

const AddedPasskeyContext = createContext("");

const SetAddedPasskeyContext = createContext<Dispatch<string> | null>(null);

/**
 * The two steps of adding a passkey: `add` until the browser has created one,
 * then `name` for the passkey it created. The name is asked for after the
 * ceremony rather than before it, so a prompt the reader closes leaves nothing
 * half-named behind; naming is a form of its own, so the passkey the add form
 * stored is held here rather than in either form.
 *
 * A browser without WebAuthn is offered neither, and the server cannot tell,
 * so both appear after hydration.
 */
const PasskeyAddition = ({
  add,
  name,
}: {
  add: ReactNode;
  name: ReactNode;
}) => {
  const [added, setAdded] = useState("");

  const supported = useSyncExternalStore(
    subscribeToNothing,
    browserSupportsWebAuthn,
    supportedOnServer
  );

  if (!supported) {
    return null;
  }

  return (
    <SetAddedPasskeyContext value={setAdded}>
      <AddedPasskeyContext value={added}>
        {added ? name : add}
      </AddedPasskeyContext>
    </SetAddedPasskeyContext>
  );
};

/**
 * What to tell the reader when the browser's half of the registration failed.
 *
 * Browsers answer a closed prompt and one that timed out with the same
 * `NotAllowedError`, so the two share a message. `InvalidStateError` is an
 * authenticator that already holds one of the reader's passkeys, which the
 * registration excluded.
 */
const ceremonyFailureMessage = (
  cause: unknown,
  t: StorefrontClientMessageAccessor
): string => {
  const name = cause instanceof Error ? cause.name : "";

  if (name === "NotAllowedError" || name === "AbortError") {
    return t("storefront.settings.passkey_add_cancelled");
  }

  if (name === "InvalidStateError") {
    return t("storefront.settings.passkey_already_registered");
  }

  return t("storefront.settings.passkey_add_failed");
};

/**
 * Asks the authenticator for a passkey over `optionsJson` and stores the one
 * it created.
 */
const createAndFinish = async (
  optionsJson: string,
  formData: FormData,
  t: StorefrontClientMessageAccessor
): Promise<PasskeyRegistrationState> => {
  try {
    const credential = await startRegistration({
      optionsJSON: JSON.parse(optionsJson),
    });

    formData.set("credential", JSON.stringify(credential));
  } catch (error) {
    return { message: ceremonyFailureMessage(error, t), ok: false };
  }

  return finishPasskeyRegistrationAction(formData);
};

/**
 * Asks one of the reader's passkeys for the assertion the registration is
 * confirmed with, and adds it to the form as `passkeyCredential`. `null` once
 * it is there, or why it is not.
 */
const confirmWithPasskey = async (
  formData: FormData,
  t: StorefrontClientMessageAccessor
): Promise<PasskeyRegistrationState> => {
  const started = await beginPasskeyConfirmationAction(formData);

  if (!started.ok) {
    return started;
  }

  try {
    const credential = await startAuthentication({
      optionsJSON: JSON.parse(started.optionsJson),
    });

    formData.set("passkeyCredential", JSON.stringify(credential));
  } catch (error) {
    // Browsers answer a closed prompt and one that timed out with the same
    // `NotAllowedError`, so the two share a message.
    const name = error instanceof Error ? error.name : "";

    return {
      message:
        name === "NotAllowedError" || name === "AbortError"
          ? t("storefront.settings.passkey_confirm_cancelled")
          : t("storefront.settings.passkey_confirm_failed"),
      ok: false,
    };
  }

  return null;
};

/**
 * Begins a registration on the server, asks the authenticator for a passkey,
 * and stores the one it created. The registration is confirmed with the
 * password the form asked for; with `confirmWith="passkey"`, with an
 * assertion one of the reader's other passkeys makes first; and with
 * `confirmWith="pending"`, with the fresh sign-in to a provider the callback
 * left waiting, which goes back to the page when the API refuses it. A
 * refusal and a closed prompt both stay on the form as its message.
 */
const PasskeyAdditionAddForm = ({
  children,
  confirmWith = "password",
}: {
  children: ReactNode;
  confirmWith?: "passkey" | "password" | "pending";
}) => {
  const t = useClientMessages();

  const add = async (
    _previousState: PasskeyRegistrationState,
    formData: FormData
  ): Promise<PasskeyRegistrationState> => {
    if (confirmWith === "passkey") {
      const refused = await confirmWithPasskey(formData, t);

      if (refused) {
        return refused;
      }
    }

    const started = await (confirmWith === "pending"
      ? beginPendingPasskeyRegistrationAction(formData)
      : beginPasskeyRegistrationAction(formData));

    if (!started.ok) {
      return started;
    }

    return createAndFinish(started.optionsJson, formData, t);
  };

  return (
    <ActionForm.Root action={add} className="grid gap-3" showSuccess={false}>
      {children}
    </ActionForm.Root>
  );
};

/** Moves `PasskeyAddition` on to naming once the add form succeeds. */
const PasskeyAdditionAdded = () => {
  const setAdded = use(SetAddedPasskeyContext);
  ActionForm.useSettled<NonNullable<PasskeyRegistrationState>>((state) => {
    if (state?.ok) {
      setAdded?.(state.passkeyId);
    }
  });

  return null;
};

/** Names the passkey the add form stored. */
const PasskeyAdditionNameForm = ({ children }: { children: ReactNode }) => (
  <ActionForm.Root
    action={namePasskeyAction}
    className="grid gap-3"
    showSuccess={false}
  >
    <input name="passkeyId" type="hidden" value={use(AddedPasskeyContext)} />
    {children}
  </ActionForm.Root>
);

/** Moves `PasskeyAddition` back to its add form once the name is saved. */
const PasskeyAdditionNamed = () => {
  const setAdded = use(SetAddedPasskeyContext);
  ActionForm.useSettled((state) => {
    if (state?.ok) {
      setAdded?.("");
    }
  });

  return null;
};

/** Leaves the passkey unnamed and goes back to the add form. */
const PasskeyAdditionSkipNaming = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  const setAdded = use(SetAddedPasskeyContext);

  return (
    <button
      className={className}
      onClick={() => {
        setAdded?.("");
      }}
      type="button"
    >
      {children}
    </button>
  );
};

export {
  PasskeyAddition as Root,
  PasskeyAdditionAdded as Added,
  PasskeyAdditionAddForm as AddForm,
  PasskeyAdditionNamed as Named,
  PasskeyAdditionNameForm as NameForm,
  PasskeyAdditionSkipNaming as SkipNaming,
};
