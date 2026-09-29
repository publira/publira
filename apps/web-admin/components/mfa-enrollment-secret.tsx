import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

import { MfaEnrollmentQrCode, MfaEnrollmentSecretText } from "./mfa-enrollment";

/** The QR code's name is an attribute rather than a node, so it waits for the catalog alone. */
const LabelledMfaEnrollmentQrCode = async () => {
  const t = await getMessages();

  return <MfaEnrollmentQrCode label={t("admin.auth.mfa.enroll_qr_label")} />;
};

/**
 * What an authenticator app needs to add the account: the code to scan, and
 * the same secret in the form that can be typed in when a camera is not an
 * option. Both come from the surrounding `MfaEnrollment`.
 */
export const MfaEnrollmentSecret = () => (
  <div className="grid gap-4">
    <div className="grid gap-1">
      <p className="text-sm font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <Message message="admin.auth.mfa.enroll_scan_title" />
        </Suspense>
      </p>
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="admin.auth.mfa.enroll_scan_description" />
        </Suspense>
      </p>
    </div>

    <div className="flex justify-center">
      <Suspense fallback={<Skeleton className="size-44" />}>
        <LabelledMfaEnrollmentQrCode />
      </Suspense>
    </div>

    <div className="grid gap-1">
      <p className="text-sm font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
          <Message message="admin.auth.mfa.enroll_secret_label" />
        </Suspense>
      </p>
      <MfaEnrollmentSecretText />
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="admin.auth.mfa.enroll_secret_help" />
        </Suspense>
      </p>
    </div>
  </div>
);
