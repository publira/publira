import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
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
import { MAX_ANDROID_CERT_FINGERPRINTS } from "#lib/tenant-mobile-app-association";
import type { TenantMobileAppAssociation } from "#lib/tenant-mobile-app-association";

import {
  AppLinksPlatform,
  AppLinksPlatformFields,
  AppLinksPlatformLegend,
  AppLinksPlatformToggle,
  RetainedInput,
  RetainedTextarea,
} from "./app-links-controls";

interface AppLinksFormProps {
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  association: TenantMobileAppAssociation;
  canEdit: boolean;
  loadErrorMessage?: string;
  tenantId: string;
}

export const AppLinksForm = ({
  action,
  association,
  canEdit,
  loadErrorMessage,
  tenantId,
}: AppLinksFormProps) => {
  const { android, ios } = association;
  // A failed read has nothing to seed the fields with, and a save from there
  // would clear what is stored.
  const locked = !canEdit || Boolean(loadErrorMessage);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
              <Message message="admin.settings.app_links.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.app_links.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>

      {loadErrorMessage ? (
        <FormMessage className="sm:max-w-3xl" variant="destructive">
          {loadErrorMessage}
        </FormMessage>
      ) : null}

      <ActionForm action={action} className="grid gap-5 sm:max-w-3xl">
        <input name="tenant_id" type="hidden" value={tenantId} />

        <ActionFormFieldset className="grid gap-5">
          {/* Keyed by what is stored, so a save the API normalized reseeds it. */}
          <AppLinksPlatform
            disabled={locked}
            initialEnabled={android !== undefined}
            key={`android:${JSON.stringify(android ?? null)}`}
          >
            <AppLinksPlatformLegend>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.settings.app_links.android_legend" />
              </Suspense>
            </AppLinksPlatformLegend>
            <AppLinksPlatformToggle name="android_enabled">
              <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                <Message message="admin.settings.app_links.android_enabled" />
              </Suspense>
            </AppLinksPlatformToggle>
            <AppLinksPlatformFields>
              <Field>
                <FieldLabel required>
                  <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                    <Message message="admin.settings.app_links.application_id" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
                  <RetainedInput
                    autoCapitalize="off"
                    autoComplete="off"
                    defaultValue={android?.applicationId ?? ""}
                    name="android_application_id"
                    placeholder="com.example.reader"
                    required
                    spellCheck={false}
                    type="text"
                  />
                </FieldContent>
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-3 w-72" />}>
                    <Message message="admin.settings.app_links.application_id_description" />
                  </Suspense>
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel required>
                  <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                    <Message message="admin.settings.app_links.fingerprints" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
                  <RetainedTextarea
                    autoCapitalize="characters"
                    autoComplete="off"
                    className="tabular-nums"
                    defaultValue={(android?.sha256CertFingerprints ?? []).join(
                      "\n"
                    )}
                    name="android_fingerprints"
                    required
                    rows={5}
                    spellCheck={false}
                  />
                </FieldContent>
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-3 w-full" />}>
                    <Message
                      message="admin.settings.app_links.fingerprints_description"
                      values={{ max: String(MAX_ANDROID_CERT_FINGERPRINTS) }}
                    />
                  </Suspense>
                </FieldDescription>
              </Field>
            </AppLinksPlatformFields>
          </AppLinksPlatform>

          <AppLinksPlatform
            disabled={locked}
            initialEnabled={ios !== undefined}
            key={`ios:${JSON.stringify(ios ?? null)}`}
          >
            <AppLinksPlatformLegend>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.settings.app_links.ios_legend" />
              </Suspense>
            </AppLinksPlatformLegend>
            <AppLinksPlatformToggle name="ios_enabled">
              <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                <Message message="admin.settings.app_links.ios_enabled" />
              </Suspense>
            </AppLinksPlatformToggle>
            <AppLinksPlatformFields>
              <Field>
                <FieldLabel required>
                  <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                    <Message message="admin.settings.app_links.team_id" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
                  <RetainedInput
                    autoCapitalize="characters"
                    autoComplete="off"
                    defaultValue={ios?.teamId ?? ""}
                    maxLength={10}
                    name="ios_team_id"
                    placeholder="ABCDE12345"
                    required
                    spellCheck={false}
                    type="text"
                  />
                </FieldContent>
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-3 w-72" />}>
                    <Message message="admin.settings.app_links.team_id_description" />
                  </Suspense>
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel required>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.settings.app_links.bundle_identifier" />
                  </Suspense>
                </FieldLabel>
                <FieldContent>
                  <RetainedInput
                    autoCapitalize="off"
                    autoComplete="off"
                    defaultValue={ios?.bundleIdentifier ?? ""}
                    name="ios_bundle_identifier"
                    placeholder="com.example.reader"
                    required
                    spellCheck={false}
                    type="text"
                  />
                </FieldContent>
                <FieldDescription>
                  <Suspense fallback={<SkeletonLine className="h-3 w-72" />}>
                    <Message message="admin.settings.app_links.bundle_identifier_description" />
                  </Suspense>
                </FieldDescription>
              </Field>
            </AppLinksPlatformFields>
          </AppLinksPlatform>
        </ActionFormFieldset>

        {canEdit ? null : (
          <FormMessage variant="destructive">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.admin_only" />
            </Suspense>
          </FormMessage>
        )}

        <div className="flex justify-end">
          <ActionFormSubmit disabled={locked}>
            <ActionFormIdle>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="admin.settings.app_links.submit" />
              </Suspense>
            </ActionFormIdle>
            <ActionFormPending>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.settings.saving" />
              </Suspense>
            </ActionFormPending>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </AdminSection>
  );
};
