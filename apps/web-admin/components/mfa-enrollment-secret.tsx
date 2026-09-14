"use client";

import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { ClientMessage } from "#components/client-message";
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
  const t = useAdminMessages();

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <ClientMessage message="admin.auth.mfa.enroll_scan_title" />
          </Suspense>
        </p>
        <p className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <ClientMessage message="admin.auth.mfa.enroll_scan_description" />
          </Suspense>
        </p>
      </div>

      <div className="flex justify-center">
        <QrCode
          label={t("admin.auth.mfa.enroll_qr_label")}
          path={qr.path}
          size={qr.size}
        />
      </div>

      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <ClientMessage message="admin.auth.mfa.enroll_secret_label" />
          </Suspense>
        </p>
        {/*
          The secret is typed into an authenticator by hand when the QR code
          cannot be scanned, so it is set in the monospace face that keeps its
          ambiguous characters apart.
        */}
        <code className="block font-mono text-sm tracking-wider break-all text-foreground">
          {secret}
        </code>
        <p className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <ClientMessage message="admin.auth.mfa.enroll_secret_help" />
          </Suspense>
        </p>
      </div>
    </div>
  );
};
