import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { TenantSiteVerification } from "#lib/tenant-site-verification";

import { updateTenantSiteVerificationAction } from "../_lib/actions";
import { TenantSiteVerificationFields } from "./tenant-site-verification-fields";

interface TenantSiteVerificationFormProps {
  canEdit: boolean;
  /**
   * The saved codes, absent when they were not read: on a failed read, and for
   * anyone but a tenant administrator, whom the API does not answer.
   */
  initialSiteVerification?: TenantSiteVerification;
  loadErrorMessage?: string;
  tenantId: string;
}

export const TenantSiteVerificationForm = ({
  canEdit,
  initialSiteVerification,
  loadErrorMessage,
  tenantId,
}: TenantSiteVerificationFormProps) => {
  // A save writes both codes, so without the saved ones it would clear the
  // tenant's; editing stays closed until the read succeeds.
  const fieldsDisabled = !canEdit || initialSiteVerification === undefined;

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message message="admin.settings.site_verification.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.site_verification.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updateTenantSiteVerificationAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionForm.Fieldset className="grid gap-4" disabled={fieldsDisabled}>
          {/* The fields hold what they were mounted with, so a read that
              arrives later — one that failed and then recovered, which also
              opens the fields — remounts them on it. Left mounted on the empty
              codes they were given, they would clear the stored ones on save. */}
          <TenantSiteVerificationFields
            initialSiteVerification={initialSiteVerification}
            key={
              initialSiteVerification
                ? `${initialSiteVerification.google}\n${initialSiteVerification.bing}`
                : ""
            }
          />
        </ActionForm.Fieldset>

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.admin_only" />
            </Suspense>
          </FormMessage>
        )}

        {loadErrorMessage ? (
          <FormMessage variant="destructive">
            <span className="block">{loadErrorMessage}</span>
            <span className="block">
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.settings.site_verification.load_error_hint" />
              </Suspense>
            </span>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionForm.Submit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.site_verification.submit" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.settings.saving" />
              </ActionForm.Pending>
            </Suspense>
          </ActionForm.Submit>
        </div>
      </ActionForm.Root>
    </ConsoleSection.Root>
  );
};
