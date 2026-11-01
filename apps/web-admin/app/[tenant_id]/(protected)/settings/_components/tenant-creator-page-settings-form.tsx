import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { TenantCreatorPageSettings } from "#lib/tenant-creator-page-settings";

import { updateTenantCreatorPageSettingsAction } from "../_lib/actions";

interface TenantCreatorPageSettingsFormProps {
  canEdit: boolean;
  /** The saved switches, absent when the read failed. */
  initialSettings?: TenantCreatorPageSettings;
  loadErrorMessage?: string;
  tenantId: string;
}

export const TenantCreatorPageSettingsForm = ({
  canEdit,
  initialSettings,
  loadErrorMessage,
  tenantId,
}: TenantCreatorPageSettingsFormProps) => {
  // Without the saved switches a save would overwrite the tenant's live choice
  // with both off, so editing stays closed until the read succeeds.
  const fieldsDisabled = !canEdit || Boolean(loadErrorMessage);
  const pagesOn = initialSettings?.creatorPagesEnabled ?? false;
  const salesOn = initialSettings?.creatorPagesShowSales ?? false;

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="admin.settings.creator_pages.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.creator_pages.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updateTenantCreatorPageSettingsAction}
        className="grid gap-4 sm:max-w-lg"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionForm.Fieldset className="grid gap-4" disabled={fieldsDisabled}>
          <Field.Root>
            <div className="flex items-center gap-2">
              {/* Keyed by the stored value, so a save that re-renders the screen
                  with a new one starts the box from it: Base UI's uncontrolled
                  default is read once. */}
              <Checkbox
                defaultChecked={pagesOn}
                key={String(pagesOn)}
                name="creator_pages_enabled"
                value="on"
              />
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                  <Message message="admin.settings.creator_pages.enabled_label" />
                </Suspense>
              </Field.Label>
            </div>
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.creator_pages.enabled_description" />
              </Suspense>
            </Field.Description>
          </Field.Root>

          <Field.Root>
            <div className="flex items-center gap-2">
              <Checkbox
                defaultChecked={salesOn}
                key={String(salesOn)}
                name="creator_pages_show_sales"
                value="on"
              />
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                  <Message message="admin.settings.creator_pages.show_sales_label" />
                </Suspense>
              </Field.Label>
            </div>
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.creator_pages.show_sales_description" />
              </Suspense>
            </Field.Description>
          </Field.Root>
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
                <Message message="admin.settings.creator_pages.load_error_hint" />
              </Suspense>
            </span>
          </FormMessage>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <ActionForm.Submit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.creator_pages.submit" />
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
