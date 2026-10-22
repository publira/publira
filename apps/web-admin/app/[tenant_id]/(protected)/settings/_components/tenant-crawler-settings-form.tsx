import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import type { TenantCrawlerSettings } from "#lib/tenant-crawler-settings";
import type { KnownCrawler } from "#lib/tenant-crawler-settings-shared";

import { updateTenantCrawlerSettingsAction } from "../_lib/actions";
import { TenantCrawlerSettingsFields } from "./tenant-crawler-settings-fields";

interface TenantCrawlerSettingsFormProps {
  canEdit: boolean;
  /** The saved setting, absent when the read failed. */
  initialSettings?: TenantCrawlerSettings;
  /** Every crawler the setting may name, absent when the read failed. */
  knownCrawlers?: readonly KnownCrawler[];
  loadErrorMessage?: string;
  tenantId: string;
}

export const TenantCrawlerSettingsForm = ({
  canEdit,
  initialSettings,
  knownCrawlers,
  loadErrorMessage,
  tenantId,
}: TenantCrawlerSettingsFormProps) => {
  // A save replaces both lists, so without the saved ones it would empty the
  // tenant's exclusions; editing stays closed until the read succeeds.
  const fieldsDisabled = !canEdit || initialSettings === undefined;

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message message="admin.settings.crawlers.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.crawlers.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateTenantCrawlerSettingsAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionFormFieldset className="grid gap-4" disabled={fieldsDisabled}>
          <TenantCrawlerSettingsFields
            initialSettings={initialSettings}
            knownCrawlers={knownCrawlers}
          />
        </ActionFormFieldset>

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
                <Message message="admin.settings.crawlers.load_error_hint" />
              </Suspense>
            </span>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionFormSubmit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
              <ActionFormIdle>
                <Message message="admin.settings.crawlers.submit" />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message="admin.settings.saving" />
              </ActionFormPending>
            </Suspense>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </AdminSection>
  );
};
