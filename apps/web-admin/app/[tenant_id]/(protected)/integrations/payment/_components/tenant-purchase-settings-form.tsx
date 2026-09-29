import {
  ActionForm,
  ActionFormFieldError,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
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
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message message="admin.settings.purchase.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.purchase.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <ActionForm
        action={updateTenantPurchaseSettingsAction}
        className="grid gap-5 sm:max-w-3xl"
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        {initialSettings === undefined ? null : (
          // A save refreshes the settings; keying on them remounts the fields
          // on what the API stored instead of changing a mounted default.
          <ActionFormFieldset
            className="grid gap-5"
            disabled={fieldsDisabled}
            key={[
              initialSettings.purchaseAvailability,
              initialSettings.appStoreUrl,
              initialSettings.googlePlayUrl,
            ].join("\n")}
          >
            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.settings.purchase.availability" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
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
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.settings.purchase.availability_description" />
                  </Suspense>
                </FieldDescription>
                <ActionFormFieldError name="purchaseAvailability" />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.settings.purchase.app_store_url" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <Input
                  defaultValue={initialSettings.appStoreUrl}
                  inputMode="url"
                  name="app_store_url"
                  placeholder="https://apps.apple.com/app/id…"
                  type="text"
                />
                <ActionFormFieldError name="appStoreUrl" />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.settings.purchase.google_play_url" />
                </Suspense>
              </FieldLabel>
              <FieldContent>
                <Input
                  defaultValue={initialSettings.googlePlayUrl}
                  inputMode="url"
                  name="google_play_url"
                  placeholder="https://play.google.com/store/apps/details?id=…"
                  type="text"
                />
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.settings.purchase.store_url_description" />
                  </Suspense>
                </FieldDescription>
                <ActionFormFieldError name="googlePlayUrl" />
              </FieldContent>
            </Field>
          </ActionFormFieldset>
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
          <ActionFormSubmit disabled={fieldsDisabled}>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <ActionFormIdle>
                <Message message="admin.settings.purchase.submit" />
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
