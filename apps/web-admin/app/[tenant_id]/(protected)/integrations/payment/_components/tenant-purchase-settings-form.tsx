import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { TenantPurchaseSettings } from "#lib/tenant-purchase-settings";

import { updateTenantPurchaseSettingsAction } from "../_lib/actions";

interface TenantPurchaseSettingsFormProps {
  canEdit: boolean;
  /** The saved settings, absent when the read failed. */
  initialSettings?: TenantPurchaseSettings;
  loadErrorMessage?: string;
  tenantId: string;
}

export const TenantPurchaseSettingsForm = ({
  canEdit,
  initialSettings,
  loadErrorMessage,
  tenantId,
}: TenantPurchaseSettingsFormProps) => {
  // A failed read leaves nothing to seed the fields with, and a save from that
  // state would write whatever they happened to hold over the stored default.
  const fieldsDisabled = !canEdit || initialSettings === undefined;

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message message="admin.settings.purchase.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.purchase.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <ActionForm.Root
        action={updateTenantPurchaseSettingsAction}
        className="grid gap-5 sm:max-w-3xl"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        {initialSettings === undefined ? null : (
          // A save refreshes the settings; keying on them remounts the fields
          // on what the API stored instead of changing a mounted default.
          <ActionForm.Fieldset
            className="grid gap-5"
            disabled={fieldsDisabled}
            key={[
              initialSettings.purchaseAvailability,
              initialSettings.appStoreUrl,
              initialSettings.googlePlayUrl,
            ].join("\n")}
          >
            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.settings.purchase.availability" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Select
                  defaultValue={initialSettings.purchaseAvailability}
                  items={[
                    {
                      label: (
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-24" />}
                        >
                          <Message message="admin.settings.purchase.options.all" />
                        </Suspense>
                      ),
                      value: "all",
                    },
                    {
                      label: (
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-20" />}
                        >
                          <Message message="admin.settings.purchase.options.web" />
                        </Suspense>
                      ),
                      value: "web",
                    },
                    {
                      label: (
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-20" />}
                        >
                          <Message message="admin.settings.purchase.options.app" />
                        </Suspense>
                      ),
                      value: "app",
                    },
                  ]}
                  name="purchase_availability"
                />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.settings.purchase.availability_description" />
                  </Suspense>
                </Field.Description>
                <ActionForm.FieldError name="purchaseAvailability" />
              </Field.Content>
            </Field.Root>

            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.settings.purchase.app_store_url" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Input
                  defaultValue={initialSettings.appStoreUrl}
                  inputMode="url"
                  name="app_store_url"
                  placeholder="https://apps.apple.com/app/id…"
                  type="text"
                />
                <ActionForm.FieldError name="appStoreUrl" />
              </Field.Content>
            </Field.Root>

            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.settings.purchase.google_play_url" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <Input
                  defaultValue={initialSettings.googlePlayUrl}
                  inputMode="url"
                  name="google_play_url"
                  placeholder="https://play.google.com/store/apps/details?id=…"
                  type="text"
                />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.settings.purchase.store_url_description" />
                  </Suspense>
                </Field.Description>
                <ActionForm.FieldError name="googlePlayUrl" />
              </Field.Content>
            </Field.Root>
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

        <div className="flex flex-wrap gap-3">
          <ActionForm.Submit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.purchase.submit" />
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
