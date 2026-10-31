"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import type { ReactNode } from "react";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { useClientMessages } from "#components/client-message";
import type { StorefrontClientMessageAccessor } from "#lib/messages";

import {
  beginPasskeyLoginAction,
  finishPasskeyLoginAction,
} from "../_lib/actions";
import type { PasskeyLoginState } from "../_lib/passkey-login-state";

/** The field the assertion reaches {@link finishPasskeyLoginAction} in. */
const CREDENTIAL_FIELD = "credential";

/** Whether a browser has WebAuthn does not change while a page is open. */
const subscribeToNothing = () => () => {
  // No teardown: there is no subscription to end.
};

/** The server cannot tell, so the control first renders as if it had none. */
const supportedOnServer = () => false;

/**
 * What to tell the reader when the browser's half of the sign-in failed.
 *
 * Browsers answer a closed prompt and one that timed out with the same
 * `NotAllowedError`, so the two share a message. Anything else — a relying
 * party ID the page's origin does not match, an authenticator that broke — has
 * nothing the reader can do about it here but try again or use their password.
 */
const ceremonyFailureMessage = (
  cause: unknown,
  t: StorefrontClientMessageAccessor
): string => {
  const name = cause instanceof Error ? cause.name : "";

  if (name === "NotAllowedError" || name === "AbortError") {
    return t("storefront.auth.errors.passkey_cancelled");
  }

  return t("storefront.auth.errors.passkey_failed");
};

const PasskeySignInForm = ({ children }: { children: ReactNode }) => {
  const t = useClientMessages();
  const credentialRef = useRef<HTMLInputElement>(null);
  // Set once the button asks for a passkey, so an autofill request still being
  // set up does not start after it and cancel the one the reader asked for.
  const buttonUsedRef = useRef(false);

  // A submission that already carries an assertion is the one autofill made
  // below; any other is the button, which asks for one first.
  const signIn = async (
    _previousState: PasskeyLoginState,
    formData: FormData
  ): Promise<PasskeyLoginState> => {
    if (formData.get(CREDENTIAL_FIELD)) {
      return finishPasskeyLoginAction(formData);
    }

    buttonUsedRef.current = true;
    const started = await beginPasskeyLoginAction(formData);

    if (!started.ok) {
      return started;
    }

    try {
      const credential = await startAuthentication({
        optionsJSON: JSON.parse(started.optionsJson),
      });

      formData.set(CREDENTIAL_FIELD, JSON.stringify(credential));
    } catch (error) {
      return { message: ceremonyFailureMessage(error, t), ok: false };
    }

    return finishPasskeyLoginAction(formData);
  };

  // Offer the reader's passkeys in the autofill of the email field, which
  // carries the `webauthn` token, for as long as the page is open. The prompt
  // only opens when the reader picks a passkey there, and the assertion is then
  // submitted through the form, so it finishes, and fails, as the button does.
  // The button cancels this request when it asks for one of its own, and one
  // the button was used before is never started. Anything that stops it is
  // left unreported: the reader has not asked for anything yet, and the button
  // is still there to ask with.
  useEffect(() => {
    const field = credentialRef.current;
    const form = field?.form;

    if (!field || !form) {
      return;
    }

    let active = true;
    const offering = () => active && !buttonUsedRef.current;

    const offerInAutofill = async () => {
      if (!(await browserSupportsWebAuthnAutofill()) || !offering()) {
        return;
      }

      const started = await beginPasskeyLoginAction(new FormData(form));

      if (!offering() || !started.ok) {
        return;
      }

      const credential = await startAuthentication({
        optionsJSON: JSON.parse(started.optionsJson),
        useBrowserAutofill: true,
      });

      if (!active) {
        return;
      }

      field.value = JSON.stringify(credential);
      form.requestSubmit();
      field.value = "";
    };

    const offerUntilStopped = async () => {
      try {
        await offerInAutofill();
      } catch {
        // Left unreported, as above.
      }
    };

    offerUntilStopped();

    return () => {
      active = false;
      WebAuthnAbortService.cancelCeremony();
    };
  }, []);

  return (
    <ActionForm.Root action={signIn} showSuccess={false}>
      <input name={CREDENTIAL_FIELD} ref={credentialRef} type="hidden" />
      {children}
    </ActionForm.Root>
  );
};

/**
 * Signs a reader in with a passkey alone, from the button among `children`
 * and from the autofill of the email field. A browser without WebAuthn is
 * offered neither, and the password form beside it is untouched either way.
 */
export const PasskeySignIn = ({ children }: { children: ReactNode }) => {
  const supported = useSyncExternalStore(
    subscribeToNothing,
    browserSupportsWebAuthn,
    supportedOnServer
  );

  return supported ? <PasskeySignInForm>{children}</PasskeySignInForm> : null;
};
