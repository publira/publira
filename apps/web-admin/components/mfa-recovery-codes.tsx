import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import { MfaRecoveryCodeList } from "./mfa-recovery-code-list";

/**
 * The batch of recovery codes, at the one moment they exist in plaintext.
 *
 * Every screen that can produce them says the same thing about them, so the
 * heading and the warning are resolved here rather than passed in. The codes
 * come from `IssuedMfaRecoveryCodes`.
 */
export const MfaRecoveryCodes = () => (
  <div className="grid gap-3 border border-border bg-muted/40 p-4">
    <div className="grid gap-1">
      <p className="text-sm font-medium text-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <Message message="admin.auth.mfa.recovery_codes_title" />
        </Suspense>
      </p>
      <p className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message message="admin.auth.mfa.recovery_codes_description" />
        </Suspense>
      </p>
    </div>
    <MfaRecoveryCodeList />
  </div>
);
