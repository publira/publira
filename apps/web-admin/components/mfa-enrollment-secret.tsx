"use client";

import { getMessage } from "@publira/i18n";

import type { QrCodePath } from "#lib/qr-code";

import { useAdminMessages } from "./admin-locale-context";
import { QrCode } from "./qr-code";

interface MfaEnrollmentSecretProps {
  qr: QrCodePath;
  secret: string;
}

/**
 * What an authenticator app needs to add the account: the code to scan, and
 * the same secret in the form that can be typed in when a camera is not an
 * option.
 */
export const MfaEnrollmentSecret = ({
  qr,
  secret,
}: MfaEnrollmentSecretProps) => {
  const messages = useAdminMessages();

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">
          {getMessage(messages, "admin.auth.mfa.enroll_scan_title")}
        </p>
        <p className="text-xs text-muted-foreground">
          {getMessage(messages, "admin.auth.mfa.enroll_scan_description")}
        </p>
      </div>

      <div className="flex justify-center">
        <QrCode
          label={getMessage(messages, "admin.auth.mfa.enroll_qr_label")}
          path={qr.path}
          size={qr.size}
        />
      </div>

      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">
          {getMessage(messages, "admin.auth.mfa.enroll_secret_label")}
        </p>
        <p className="font-mono text-sm tracking-wider break-all text-foreground">
          {secret}
        </p>
        <p className="text-xs text-muted-foreground">
          {getMessage(messages, "admin.auth.mfa.enroll_secret_help")}
        </p>
      </div>
    </div>
  );
};
