import { FieldDescription } from "@publira/ui-components/field";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import {
  ProviderCredentialHint,
  ProviderCredentialModeButton,
  ProviderCredentialSecretInput,
  ProviderCredentialWhile,
} from "./provider-credentials";

/**
 * A write-only secret a provider declares, inside its `ProviderCredential`: a
 * stored one shows only its hint until replaced, and one the provider does not
 * require can be removed.
 */
export const ProviderSecretControls = ({
  configured,
  required,
}: {
  /** Whether a value is stored, which offers going back to it. */
  configured: boolean;
  /** Whether the provider requires the field, which keeps it from removal. */
  required: boolean;
}) => (
  <>
    <ProviderCredentialWhile mode="keep">
      <div className="flex flex-wrap items-center gap-3">
        <ProviderCredentialHint />
        <ProviderCredentialModeButton mode="replace">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.settings.credentials.secret_change" />
          </Suspense>
        </ProviderCredentialModeButton>
        {required ? null : (
          <ProviderCredentialModeButton mode="clear">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.settings.credentials.secret_remove" />
            </Suspense>
          </ProviderCredentialModeButton>
        )}
      </div>
    </ProviderCredentialWhile>
    <ProviderCredentialWhile mode="replace">
      <div className="flex flex-wrap items-center gap-3">
        <ProviderCredentialSecretInput />
        {configured ? (
          <ProviderCredentialModeButton mode="keep">
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.settings.credentials.secret_change_cancel" />
            </Suspense>
          </ProviderCredentialModeButton>
        ) : null}
      </div>
    </ProviderCredentialWhile>
    <ProviderCredentialWhile mode="clear">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="admin.settings.credentials.secret_removed" />
          </Suspense>
        </p>
        <ProviderCredentialModeButton mode="keep">
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.settings.credentials.secret_remove_cancel" />
          </Suspense>
        </ProviderCredentialModeButton>
      </div>
    </ProviderCredentialWhile>
  </>
);

/** What a secret field says about how it is kept. */
export const ProviderSecretDescription = () => (
  <FieldDescription>
    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
      <Message message="admin.settings.credentials.secret_description" />
    </Suspense>
  </FieldDescription>
);
