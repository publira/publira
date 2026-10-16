/**
 * What starting a passkey sign-in answers the browser with. It is read by the
 * Client Component that runs the ceremony rather than shown, so success
 * carries no message of its own.
 */
export type PasskeyLoginStartState =
  | { ok: true; message: string; optionsJson: string }
  | { ok: false; message: string };

/**
 * What finishing a passkey sign-in answers. A sign-in that succeeds leaves
 * the page from the Action, so only a refusal comes back.
 */
export type PasskeyLoginState = { ok: false; message: string } | null;
