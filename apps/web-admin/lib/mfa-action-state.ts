/**
 * Server Action states for the second factor.
 *
 * They live in `lib/` rather than beside one screen because two screens run
 * the same steps: the enrollment a tenant holds an administrator at during
 * login (`/mfa`), and the one an administrator starts themselves from their
 * account settings.
 */

import type { QrCodePath } from "@publira/ui-components/qr-code";

export type MfaEnrollmentStartState =
  | {
      ok: true;
      /** Empty: the confirm step takes the form's place. */
      message: string;
      /** Shown for an authenticator that is typed into rather than scanned. */
      secret: string;
      qr: QrCodePath;
    }
  | { ok: false; message: string }
  | null;

export type MfaEnrollmentConfirmState =
  | {
      ok: true;
      message: string;
      /** Plaintext exactly once; the API keeps only hashes. */
      recoveryCodes: string[];
      /**
       * Whether the console now holds a session. False when a challenge
       * enrollment finished but the API could not issue one, in which case the
       * codes are still worth showing and the operator signs in again.
       */
      signedIn: boolean;
    }
  | { ok: false; message: string }
  | null;

/**
 * What starting a passkey ceremony answers the browser with. It is read by
 * the Client Component that runs the ceremony rather than shown, so success
 * carries no message of its own.
 */
export type PasskeyCeremonyStartState =
  | { ok: true; message: string; optionsJson: string }
  | { ok: false; message: string };

/**
 * What adding a passkey from the account settings answers: the passkey, for
 * naming it next, and the recovery codes when it was the account's first
 * factor.
 */
export type PasskeyRegistrationState =
  | {
      ok: true;
      message: string;
      passkeyId: string;
      /** Empty unless this passkey brought the account's first batch. */
      recoveryCodes: string[];
    }
  | { ok: false; message: string }
  | null;

export type MfaVerifyState =
  /**
   * Only a recovery code lands here. A code from the authenticator finishes
   * the login outright, and the Action redirects instead of answering. The
   * message says how many recovery codes are left.
   */
  { ok: true; message: string } | { ok: false; message: string } | null;

export type MfaRecoveryCodesState =
  | { ok: true; message: string; recoveryCodes: string[] }
  | { ok: false; message: string }
  | null;
