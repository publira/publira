"use client";

import type * as ActionForm from "@publira/ui-components/action-form";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

import { useClientMessages } from "#components/client-message";
import type { AdminClientMessageAccessor } from "#lib/messages";
import type { PasskeyCeremonyStartState } from "#lib/mfa-action-state";

interface PasskeyFailure {
  ok: false;
  message: string;
}

type CeremonyOutcome = { ok: true; credential: string } | PasskeyFailure;

/**
 * What to tell the operator when the browser's half of a ceremony failed.
 *
 * Browsers answer a closed prompt and one that timed out with the same
 * `NotAllowedError`, so the two share a message. `InvalidStateError` is an
 * authenticator that already holds a credential the registration excluded.
 * Anything else — a relying party ID the page's origin does not match, an
 * authenticator that broke — has nothing the operator can do about it here
 * but try again or use another factor instead.
 */
const ceremonyFailureMessage = (
  error: unknown,
  t: AdminClientMessageAccessor
): string => {
  const name = error instanceof Error ? error.name : "";

  if (name === "NotAllowedError" || name === "AbortError") {
    return t("admin.auth.mfa.errors.passkey_cancelled");
  }

  if (name === "InvalidStateError") {
    return t("admin.auth.mfa.errors.passkey_already_registered");
  }

  return t("admin.auth.mfa.errors.passkey_failed");
};

/**
 * Run the browser's half of a ceremony with the options the API began it
 * with, answering the credential as the JSON the API parses.
 */
const runCeremony = async (
  ceremony: (optionsJson: string) => Promise<unknown>,
  optionsJson: string,
  t: AdminClientMessageAccessor
): Promise<CeremonyOutcome> => {
  try {
    const credential = await ceremony(optionsJson);

    return { credential: JSON.stringify(credential), ok: true };
  } catch (error) {
    return { message: ceremonyFailureMessage(error, t), ok: false };
  }
};

/**
 * Begin a ceremony on the server, run it in the browser, and hand the result
 * to `finish` as the form's `credential` field.
 *
 * A browser with no WebAuthn is turned away before anything is begun, so it
 * opens no ceremony it could never finish. A failure of the browser's half,
 * and a refusal the Actions classify, come back as the form's message rather
 * than a throw, so the screen's other factor stays one click away. An RPC
 * failure the Actions cannot classify is rethrown to the error boundary, as it
 * is everywhere else, and a redirect from either Action is not a failure — it
 * is how a spent challenge or a lost session goes back to `/login` and a
 * finished sign-in goes on — so both are left to propagate.
 */
export const usePasskeyCeremony = <State extends ActionForm.Result | null>(
  begin: (formData: FormData) => Promise<PasskeyCeremonyStartState>,
  ceremony: (optionsJson: string) => Promise<unknown>,
  finish: (formData: FormData) => Promise<State>
) => {
  const t = useClientMessages();

  return async (
    _previousState: State | PasskeyFailure | null,
    formData: FormData
  ): Promise<State | PasskeyFailure> => {
    if (!browserSupportsWebAuthn()) {
      return {
        message: t("admin.auth.mfa.errors.passkey_unsupported"),
        ok: false,
      };
    }

    const started = await begin(formData);

    if (!started.ok) {
      return started;
    }

    const outcome = await runCeremony(ceremony, started.optionsJson, t);

    if (!outcome.ok) {
      return outcome;
    }

    formData.set("credential", outcome.credential);

    return finish(formData);
  };
};

/** The browser's half of answering with a passkey the account holds. */
export const authenticatePasskey = (optionsJson: string) =>
  startAuthentication({ optionsJSON: JSON.parse(optionsJson) });

/** The browser's half of creating a passkey for the account. */
export const registerPasskey = (optionsJson: string) =>
  startRegistration({ optionsJSON: JSON.parse(optionsJson) });
