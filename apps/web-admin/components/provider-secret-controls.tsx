import * as Field from "@publira/ui-components/field";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";

import * as ProviderCredential from "./provider-credential";

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
    <ProviderCredential.While mode="keep">
      <div className="flex flex-wrap items-center gap-3">
        <ProviderCredential.Hint />
        <ProviderCredential.ModeButton mode="replace">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.settings.credentials.secret_change" />
          </Suspense>
        </ProviderCredential.ModeButton>
        {required ? null : (
          <ProviderCredential.ModeButton mode="clear">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.settings.credentials.secret_remove" />
            </Suspense>
          </ProviderCredential.ModeButton>
        )}
      </div>
    </ProviderCredential.While>
    <ProviderCredential.While mode="replace">
      <div className="flex flex-wrap items-center gap-3">
        <ProviderCredential.SecretInput />
        {configured ? (
          <ProviderCredential.ModeButton mode="keep">
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.settings.credentials.secret_change_cancel" />
            </Suspense>
          </ProviderCredential.ModeButton>
        ) : null}
      </div>
    </ProviderCredential.While>
    <ProviderCredential.While mode="clear">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="admin.settings.credentials.secret_removed" />
          </Suspense>
        </p>
        <ProviderCredential.ModeButton mode="keep">
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.settings.credentials.secret_remove_cancel" />
          </Suspense>
        </ProviderCredential.ModeButton>
      </div>
    </ProviderCredential.While>
  </>
);

/** What a secret field says about how it is kept. */
export const ProviderSecretDescription = () => (
  <Field.Description>
    <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
      <Message message="admin.settings.credentials.secret_description" />
    </Suspense>
  </Field.Description>
);
