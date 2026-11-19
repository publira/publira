/**
 * What a form that creates a credential gets back: on success, the value the
 * server answered this once, which the form shows until it is submitted again.
 * Nothing stores it, so reloading the page is what takes it off the screen.
 */
export type IssuedSecretFormState =
  | { message: string; ok: true; secret: string }
  | { message: string; ok: false }
  | null;
