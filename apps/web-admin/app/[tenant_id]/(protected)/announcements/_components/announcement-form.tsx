import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import { Checkbox } from "@publira/ui-components/checkbox";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense } from "react";

import { InstantInput } from "#components/instant-input";
import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";
import type { TenantLocales } from "#lib/tenant-locales";

import type { CreateAnnouncementActionState } from "../announcement-types";
import * as AnnouncementPinned from "./announcement-pinned-controls";
import { AnnouncementTranslationTabs } from "./announcement-translation-tabs";

interface AnnouncementFormProps {
  action: (
    prevState: CreateAnnouncementActionState,
    formData: FormData
  ) => Promise<CreateAnnouncementActionState>;
  tenantId: string;
  /**
   * The languages the site offers, one tab each, or `null` when they cannot be
   * read: the form then takes the announcement in the default language alone.
   */
  tenantLocales: TenantLocales | null;
  /** The tenant's display zone, which the banner's stop time is written in. */
  timeZone: string;
}

/** The fields' placeholders, which are attributes rather than nodes. */
interface AnnouncementTranslationPlaceholders {
  title: string;
  body: string;
}

/**
 * One language's title and body. The default language's are required, the
 * others optional, and `translation_locale` is posted empty for the default
 * one so the API resolves it to whatever the tenant's default is when the
 * announcement arrives.
 */
const AnnouncementTranslationFields = ({
  locale,
  placeholders,
}: {
  /** The language these fields are written in, absent for the default one. */
  locale?: Locale;
  placeholders: AnnouncementTranslationPlaceholders;
}) => {
  const required = locale === undefined;

  return (
    <>
      <input name="translation_locale" type="hidden" value={locale ?? ""} />

      <Field.Root>
        <Field.Label required={required}>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.announcements.form.title" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <Input
            maxLength={120}
            name="title"
            placeholder={placeholders.title}
            required={required}
            type="text"
          />
        </Field.Content>
      </Field.Root>

      <Field.Root>
        <Field.Label required={required}>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.announcements.form.body" />
          </Suspense>
        </Field.Label>
        <Field.Content>
          <Textarea
            maxLength={2000}
            name="body"
            placeholder={placeholders.body}
            required={required}
            rows={5}
          />
        </Field.Content>
      </Field.Root>
    </>
  );
};

/**
 * The title and body in every language the site offers, a tab each and the
 * default language's open first.
 */
const AnnouncementTranslations = ({
  placeholders,
  tabsLabel,
  tenantLocales,
}: {
  placeholders: AnnouncementTranslationPlaceholders;
  tabsLabel: string;
  tenantLocales: TenantLocales | null;
}) => {
  if (!tenantLocales) {
    return <AnnouncementTranslationFields placeholders={placeholders} />;
  }

  const { defaultLocale, supportedLocales } = tenantLocales;

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
          <Message
            message="admin.announcements.form.translations_description"
            values={{ language: getLocaleLabel(defaultLocale) }}
          />
        </Suspense>
      </p>
      <AnnouncementTranslationTabs
        defaultLocale={defaultLocale}
        label={tabsLabel}
        panels={supportedLocales.map((code) => ({
          fields: (
            <AnnouncementTranslationFields
              locale={code === defaultLocale ? undefined : code}
              placeholders={placeholders}
            />
          ),
          locale: code,
        }))}
      />
    </div>
  );
};

/**
 * Awaits the catalog for its placeholders, which are attributes rather than
 * nodes. A delivery redirects from the Action to the list.
 */
export const AnnouncementForm = async ({
  action,
  tenantId,
  tenantLocales,
  timeZone,
}: AnnouncementFormProps) => {
  const t = await getMessages();

  return (
    <ActionForm.Root action={action} className="grid gap-5">
      <input name="tenant_id" type="hidden" value={tenantId} />

      <ActionForm.Fieldset className="grid gap-5">
        <AnnouncementTranslations
          placeholders={{
            body: t("admin.announcements.form.body_placeholder"),
            title: t("admin.announcements.form.title_placeholder"),
          }}
          tabsLabel={t("admin.translations.tabs_label")}
          tenantLocales={tenantLocales}
        />

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="admin.announcements.form.link" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              name="link_url"
              placeholder={t("admin.announcements.form.link_placeholder")}
              type="text"
            />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.announcements.form.link_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.announcements.form.send_to_everyone" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Checkbox name="delivery" value="everyone" />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.announcements.form.send_to_everyone_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        <AnnouncementPinned.Root>
          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="admin.announcements.form.pinned" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <AnnouncementPinned.Checkbox />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.announcements.form.pinned_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>

          <AnnouncementPinned.While>
            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.announcements.form.pinned_until" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <InstantInput
                  name="pinned_until"
                  step={60}
                  timeZone={timeZone}
                />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message
                      message="admin.announcements.form.pinned_until_description"
                      values={{ time_zone: timeZone }}
                    />
                  </Suspense>
                </Field.Description>
              </Field.Content>
            </Field.Root>
          </AnnouncementPinned.While>
        </AnnouncementPinned.Root>
      </ActionForm.Fieldset>

      <div className="flex justify-end">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="admin.announcements.form.submit" />
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.announcements.form.submitting" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  );
};
