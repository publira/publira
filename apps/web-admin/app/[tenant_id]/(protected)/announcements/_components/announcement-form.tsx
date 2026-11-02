import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense } from "react";

import { InstantInput } from "#components/instant-input";
import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";
import type { TenantLocales } from "#lib/tenant-locales";

import type {
  AnnouncementItem,
  AnnouncementTranslation,
  CreateAnnouncementActionState,
} from "../announcement-types";
import * as AnnouncementAudience from "./announcement-audience-fields";
import type {
  AudiencePlan,
  AudienceSeries,
} from "./announcement-audience-fields";
import * as AnnouncementPinned from "./announcement-pinned-controls";
import * as AnnouncementSchedule from "./announcement-schedule-controls";
import { AnnouncementTranslationTabs } from "./announcement-translation-tabs";

interface AnnouncementFormProps {
  action: (
    prevState: CreateAnnouncementActionState,
    formData: FormData
  ) => Promise<CreateAnnouncementActionState>;
  /** The scheduled announcement being edited; absent while one is created. */
  announcement?: AnnouncementItem;
  /** The plans a subscription condition can name. */
  plans: readonly AudiencePlan[];
  /** Why the plans could not be listed, shown beside the plan select. */
  plansErrorMessage?: string;
  /** The series a series condition can name. */
  series: readonly AudienceSeries[];
  /** Why the series could not be listed, shown beside the series combobox. */
  seriesErrorMessage?: string;
  tenantId: string;
  /**
   * The languages the site offers, one tab each, or `null` when they cannot be
   * read: the form then takes the announcement in the default language alone.
   */
  tenantLocales: TenantLocales | null;
  /** The tenant's display zone, which the delivery and banner times are written in. */
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
  initial,
  locale,
  placeholders,
}: {
  /** What the announcement being edited says in this language. */
  initial?: Pick<AnnouncementTranslation, "body" | "title">;
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
            defaultValue={initial?.title}
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
            defaultValue={initial?.body}
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
  announcement,
  placeholders,
  tabsLabel,
  tenantLocales,
}: {
  announcement?: AnnouncementItem;
  placeholders: AnnouncementTranslationPlaceholders;
  tabsLabel: string;
  tenantLocales: TenantLocales | null;
}) => {
  if (!tenantLocales) {
    // The API names the default language's translation as the announcement's
    // own title and body, which is the one this single tab writes.
    return (
      <AnnouncementTranslationFields
        initial={announcement}
        placeholders={placeholders}
      />
    );
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
              initial={announcement?.translations.find(
                ({ locale }) => locale === code
              )}
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
 * Who the announcement is for: everyone, or the readers who meet every
 * condition, with how many that is.
 */
const AnnouncementAudienceSection = ({
  plans,
  plansErrorMessage,
  series,
  seriesErrorMessage,
  tenantId,
  tenantLocales,
}: Pick<
  AnnouncementFormProps,
  | "plans"
  | "plansErrorMessage"
  | "series"
  | "seriesErrorMessage"
  | "tenantId"
  | "tenantLocales"
>) => (
  <div className="grid gap-3">
    <Field.Root>
      <Field.Label>
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.announcements.form.audience" />
        </Suspense>
      </Field.Label>
      <Field.Content>
        <AnnouncementAudience.Mode />
      </Field.Content>
    </Field.Root>
    <AnnouncementAudience.Conditions
      locales={
        tenantLocales
          ? [
              tenantLocales.defaultLocale,
              ...tenantLocales.supportedLocales.filter(
                (code) => code !== tenantLocales.defaultLocale
              ),
            ]
          : []
      }
      plans={plans}
      plansErrorMessage={plansErrorMessage}
      series={series}
      seriesErrorMessage={seriesErrorMessage}
      tenantId={tenantId}
    />
    <ActionForm.FieldError name="audience" />
  </div>
);

/**
 * Creates an announcement, or saves a scheduled one, through `action`. Awaits
 * the catalog for its placeholders, which are attributes rather than nodes. A
 * delivery, a schedule, and a save all redirect from the Action to the list.
 */
export const AnnouncementForm = async ({
  action,
  announcement,
  plans,
  plansErrorMessage,
  series,
  seriesErrorMessage,
  tenantId,
  tenantLocales,
  timeZone,
}: AnnouncementFormProps) => {
  const t = await getMessages();
  const initialDeliverAt = announcement?.deliverAt ?? "";

  return (
    <ActionForm.Root action={action} className="grid gap-5">
      <input name="tenant_id" type="hidden" value={tenantId} />
      {announcement ? (
        <input name="announcement_id" type="hidden" value={announcement.id} />
      ) : null}

      <AnnouncementSchedule.Root initialDeliverAt={initialDeliverAt}>
        <AnnouncementAudience.Root
          initialConditions={announcement?.audience ?? null}
        >
          <ActionForm.Fieldset className="grid gap-5">
            <AnnouncementTranslations
              announcement={announcement}
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
                  defaultValue={announcement?.linkUrl}
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

            <AnnouncementAudienceSection
              plans={plans}
              plansErrorMessage={plansErrorMessage}
              series={series}
              seriesErrorMessage={seriesErrorMessage}
              tenantId={tenantId}
              tenantLocales={tenantLocales}
            />

            <AnnouncementAudience.WhileTargeted>
              <p className="text-sm text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.announcements.form.targeted_notice" />
                </Suspense>
              </p>
            </AnnouncementAudience.WhileTargeted>

            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.announcements.form.send_to_everyone" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <AnnouncementAudience.DeliveryCheckbox
                  defaultChecked={announcement?.delivery === "everyone"}
                />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message message="admin.announcements.form.send_to_everyone_description" />
                  </Suspense>
                </Field.Description>
              </Field.Content>
            </Field.Root>

            <AnnouncementPinned.Root initialPinned={announcement?.pinned}>
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
                      initialValue={announcement?.pinnedUntil}
                      name="pinned_until"
                      step={60}
                      timeZone={timeZone}
                    />
                    <Field.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-3/4" />}
                      >
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

            <Field.Root>
              <Field.Label>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.announcements.form.deliver_at" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <AnnouncementSchedule.Input
                  initialDeliverAt={initialDeliverAt}
                  timeZone={timeZone}
                />
                <Field.Description>
                  <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                    <Message
                      message="admin.announcements.form.deliver_at_description"
                      values={{ time_zone: timeZone }}
                    />
                  </Suspense>
                </Field.Description>
                <ActionForm.FieldError name="deliverAt" />
              </Field.Content>
            </Field.Root>
          </ActionForm.Fieldset>
        </AnnouncementAudience.Root>

        <div className="flex justify-end">
          <ActionForm.Submit>
            {announcement ? (
              <>
                <ActionForm.Idle>
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.announcements.form.save" />
                  </Suspense>
                </ActionForm.Idle>
                <ActionForm.Pending>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="admin.announcements.form.saving" />
                  </Suspense>
                </ActionForm.Pending>
              </>
            ) : (
              <>
                <ActionForm.Idle>
                  <AnnouncementSchedule.WhileImmediate>
                    <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                      <Message message="admin.announcements.form.submit" />
                    </Suspense>
                  </AnnouncementSchedule.WhileImmediate>
                  <AnnouncementSchedule.WhileScheduled>
                    <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                      <Message message="admin.announcements.form.submit_schedule" />
                    </Suspense>
                  </AnnouncementSchedule.WhileScheduled>
                </ActionForm.Idle>
                <ActionForm.Pending>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.announcements.form.submitting" />
                  </Suspense>
                </ActionForm.Pending>
              </>
            )}
          </ActionForm.Submit>
        </div>
      </AnnouncementSchedule.Root>
    </ActionForm.Root>
  );
};
