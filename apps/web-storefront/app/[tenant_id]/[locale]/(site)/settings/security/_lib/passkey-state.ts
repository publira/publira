/**
 * What beginning a passkey registration answers the browser with. It is read
 * by the Client Component that runs the ceremony rather than shown, so success
 * carries no message of its own.
 */
export type PasskeyRegistrationStartState =
  | { ok: true; message: string; optionsJson: string }
  | { ok: false; message: string };

/**
 * What finishing a passkey registration answers: the passkey stored, for the
 * naming step that follows to name, or why it was not.
 */
export type PasskeyRegistrationState =
  | { ok: true; message: string; passkeyId: string }
  | { ok: false; message: string }
  | null;
