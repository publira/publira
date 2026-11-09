import type { QrCodePath } from "@publira/ui-components/qr-code";

/** What starting to set an authenticator up answers the enrollment with. */
export type MfaEnrollmentStartState =
  | {
      ok: true;
      /** Empty: the confirm step takes the form's place. */
      message: string;
      qr: QrCodePath;
      /** The key to type, for an authenticator that cannot scan. */
      secret: string;
    }
  | { ok: false; message: string }
  | null;

/**
 * What a change that keeps two-step verification on answers: the message to
 * report, and the recovery codes it issued, in plaintext this once.
 */
export type MfaSettingsChangeState =
  | { ok: true; message: string; recoveryCodes: string[] }
  | { ok: false; message: string }
  | null;
