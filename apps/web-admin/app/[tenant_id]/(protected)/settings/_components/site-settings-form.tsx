import type { Locale } from "@publira/i18n";
import {
  ActionForm,
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
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { TranslationTabs } from "#components/translation-tabs";
import { getMessages } from "#lib/get-messages";
import type {
  TenantSiteSettings,
  TenantSiteSettingsTabs,
} from "#lib/site-settings";
import { translationEditPath } from "#lib/translation-locales";

import { updateSiteSettingsAction } from "../_lib/actions";

interface SiteSettingsFieldsProps {
  canEdit: boolean;
  settings: TenantSiteSettings;
  tenantId: string;
  /** The language the copy is written in; absent, the default language. */
  translationLocale: Locale | undefined;
}

/** Awaits the catalog for its placeholders, which are attributes rather than nodes. */
export const SiteSettingsFields = async ({
  canEdit,
  settings,
  tenantId,
  translationLocale,
}: SiteSettingsFieldsProps) => {
  const t = await getMessages();

  return (
    <ActionForm action={updateSiteSettingsAction} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input
        name="translation_locale"
        type="hidden"
        value={translationLocale ?? ""}
      />

      <ActionFormFieldset className="grid gap-4" disabled={!canEdit}>
        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.settings.site.copyright" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={settings.copyrightText}
              name="copyright_text"
              placeholder={t("admin.settings.site.copyright_placeholder")}
              type="text"
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.site.copyright_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.settings.site.tagline" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={settings.siteTagline}
              name="site_tagline"
              placeholder={t("admin.settings.site.tagline_placeholder")}
              type="text"
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.site.tagline_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.settings.site.site_description" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Textarea
              defaultValue={settings.siteDescription}
              name="site_description"
              placeholder={t(
                "admin.settings.site.site_description_placeholder"
              )}
              rows={3}
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.site.site_description_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>
      </ActionFormFieldset>

      {canEdit ? null : (
        <FormMessage variant="destructive">
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.settings.admin_only" />
          </Suspense>
        </FormMessage>
      )}

      <div className="mt-2 flex justify-end gap-2">
        <ActionFormSubmit disabled={!canEdit}>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <ActionFormIdle>
              <Message message="admin.settings.site.submit" />
            </ActionFormIdle>
            <ActionFormPending>
              <Message message="admin.settings.saving" />
            </ActionFormPending>
          </Suspense>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  );
};

interface SiteSettingsFormProps {
  canEdit: boolean;
  tabs: TenantSiteSettingsTabs;
  tenantId: string;
}

/** The site's copy, with a tab per language the site offers. */
export const SiteSettingsForm = ({
  canEdit,
  tabs: { locales, settings, shownLocale, translatedLocales },
  tenantId,
}: SiteSettingsFormProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="admin.settings.site.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.site.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>
    {shownLocale ? (
      <TranslationTabs
        hrefFor={(code) => translationEditPath("/settings", code)}
        locales={locales}
        selectedLocale={shownLocale}
        translatedLocales={translatedLocales}
      />
    ) : null}
    <SiteSettingsFields
      canEdit={canEdit}
      // A form per language, so a line typed on one tab never carries over to
      // another.
      key={shownLocale ?? ""}
      settings={settings}
      tenantId={tenantId}
      translationLocale={shownLocale}
    />
  </AdminSection>
);
