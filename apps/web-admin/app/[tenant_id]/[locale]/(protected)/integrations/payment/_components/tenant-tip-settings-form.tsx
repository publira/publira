import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { TenantTipSettings } from "#lib/tenant-purchase-settings";

import { updateTenantTipSettingsAction } from "../_lib/actions";
import { TenantTipSettingsFields } from "./tenant-tip-settings-fields";

interface TenantTipSettingsFormProps {
  canEdit: boolean;
  /**
   * The currency the amounts are entered in, absent when it could not be
   * read: an amount in no currency is a number nobody can read.
   */
  currency?: string;
  /** The saved settings, absent when the read failed. */
  initialSettings?: TenantTipSettings;
  loadErrorMessage?: string;
  tenantId: string;
}

/**
 * Whether readers may tip the Authors of an episode, and the amounts they may
 * give. A save writes the amounts in ascending order, and the fields remount on
 * what it stored.
 */
export const TenantTipSettingsForm = ({
  canEdit,
  currency,
  initialSettings,
  loadErrorMessage,
  tenantId,
}: TenantTipSettingsFormProps) => {
  // A save replaces the whole list, so without the saved one it would empty
  // the tenant's amounts; editing stays closed until both reads succeed.
  const fieldsDisabled =
    !canEdit || initialSettings === undefined || currency === undefined;

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-16" />}>
              <Message message="admin.settings.tips.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.tips.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updateTenantTipSettingsAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        {initialSettings === undefined || currency === undefined ? null : (
          <ActionForm.Fieldset
            className="grid gap-4"
            disabled={fieldsDisabled}
            key={[
              currency,
              initialSettings.enabled,
              ...initialSettings.amounts,
            ].join("\n")}
          >
            <TenantTipSettingsFields
              currency={currency}
              initialSettings={initialSettings}
            />
          </ActionForm.Fieldset>
        )}

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.admin_only" />
            </Suspense>
          </FormMessage>
        )}

        {loadErrorMessage ? (
          <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionForm.Submit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.tips.submit" />
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
