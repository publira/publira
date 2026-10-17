/**
 * What beginning a passkey confirmation answers the browser with. It is read
 * by the Client Component that runs the ceremony rather than shown, so success
 * carries no message of its own.
 */
export type PasskeyConfirmationStartState =
  | { ok: true; message: string; optionsJson: string }
  | { ok: false; message: string };
