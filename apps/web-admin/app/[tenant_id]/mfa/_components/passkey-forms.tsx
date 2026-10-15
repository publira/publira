"use client";

import { ActionForm } from "@publira/ui-components/action-form";
import type { ActionFormResult } from "@publira/ui-components/action-form";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type { ReactNode } from "react";

import { useClientMessages } from "#components/client-message";
import type { AdminClientMessageAccessor } from "#lib/messages";
import type {
  MfaEnrollmentConfirmState,
  MfaVerifyState,
  PasskeyCeremonyStartState,
} from "#lib/mfa-action-state";

import {
  beginPasskeyRegistrationAction,
  beginPasskeyVerificationAction,
  finishPasskeyRegistrationAction,
  finishPasskeyVerificationAction,
} from "../_lib/actions";

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
 * but try again or use the code instead.
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
 * to `finish`.
 *
 * A browser with no WebAuthn is turned away before anything is begun, so it
 * opens no ceremony it could never finish. Every failure comes back as the
 * form's message rather than a throw: the code form has to stay one click
 * away whatever went wrong. A redirect from either Action is not a failure —
 * it is how a spent challenge goes back to `/login` and a finished one goes on
 * — so it is left to propagate.
 */
const usePasskeyCeremony = <State extends ActionFormResult | null>(
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

const authenticate = (optionsJson: string) =>
  startAuthentication({ optionsJSON: JSON.parse(optionsJson) });

const register = (optionsJson: string) =>
  startRegistration({ optionsJSON: JSON.parse(optionsJson) });

/**
 * Answers the verify challenge with one of the account's passkeys. Success
 * leaves `/mfa` from the Action, so the form only ever shows a failure.
 */
export const PasskeyVerifyForm = ({ children }: { children: ReactNode }) => {
  const verify = usePasskeyCeremony<MfaVerifyState>(
    beginPasskeyVerificationAction,
    authenticate,
    finishPasskeyVerificationAction
  );

  return (
    <ActionForm action={verify} className="grid gap-4" showSuccess={false}>
      {children}
    </ActionForm>
  );
};

/**
 * Enrolls a passkey in place of the authenticator app. Its success is the
 * same answer confirming an authenticator gives, so `MfaEnrollmentConfirmed`
 * among the children moves the flow on to the recovery codes.
 */
export const PasskeyEnrollForm = ({ children }: { children: ReactNode }) => {
  const enroll = usePasskeyCeremony<MfaEnrollmentConfirmState>(
    beginPasskeyRegistrationAction,
    register,
    finishPasskeyRegistrationAction
  );

  return (
    <ActionForm action={enroll} className="grid gap-4" showSuccess={false}>
      {children}
    </ActionForm>
  );
};
