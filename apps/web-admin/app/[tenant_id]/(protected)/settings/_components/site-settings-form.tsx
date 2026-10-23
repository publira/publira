import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
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
    <ActionForm.Root action={updateSiteSettingsAction} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input
        name="translation_locale"
        type="hidden"
        value={translationLocale ?? ""}
      />

      <ActionForm.Fieldset className="grid gap-4" disabled={!canEdit}>
        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.settings.site.copyright" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={settings.copyrightText}
              name="copyright_text"
              placeholder={t("admin.settings.site.copyright_placeholder")}
              type="text"
            />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.site.copyright_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="admin.settings.site.tagline" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={settings.siteTagline}
              name="site_tagline"
              placeholder={t("admin.settings.site.tagline_placeholder")}
              type="text"
            />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.site.tagline_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.settings.site.site_description" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Textarea
              defaultValue={settings.siteDescription}
              name="site_description"
              placeholder={t(
                "admin.settings.site.site_description_placeholder"
              )}
              rows={3}
            />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.settings.site.site_description_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>
      </ActionForm.Fieldset>

      {canEdit ? null : (
        <FormMessage variant="destructive">
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.settings.admin_only" />
          </Suspense>
        </FormMessage>
      )}

      <div className="mt-2 flex justify-end gap-2">
        <ActionForm.Submit disabled={!canEdit}>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <ActionForm.Idle>
              <Message message="admin.settings.site.submit" />
            </ActionForm.Idle>
            <ActionForm.Pending>
              <Message message="admin.settings.saving" />
            </ActionForm.Pending>
          </Suspense>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
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
