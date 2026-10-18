"use server";

import { getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { isValidTimeZone } from "@publira/utils";
import { toFieldErrors, toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { requestAdminEmailChange } from "#lib/admin-auth";
import { tenantIdFormSchema } from "#lib/auth-input";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { getMessagesFor } from "#lib/messages";
import { tenantSiteCacheTag } from "#lib/public-api";
import {
  tenantSiteSettingsCacheTag,
  updateTenantSiteSettings,
} from "#lib/site-settings";
import {
  tenantAgeVerificationCacheTag,
  updateTenantAgeVerification,
} from "#lib/tenant-age-verification";
import { TENANT_AGE_VERIFICATIONS } from "#lib/tenant-age-verification-shared";
import {
  tenantCommentSettingsCacheTag,
  updateTenantCommentSettings,
} from "#lib/tenant-comment-settings";
import {
  MAX_TENANT_COMMENT_AUTO_HIDE_REPORT_THRESHOLD,
  TENANT_COMMENT_MODES,
} from "#lib/tenant-comment-settings-shared";
import {
  tenantEmailRejectionSettingsCacheTag,
  updateTenantEmailRejectionSettings,
} from "#lib/tenant-email-rejection-settings";
import {
  MAX_EMAIL_REJECTION_ENTRIES,
  parseEmailRejectionEntries,
} from "#lib/tenant-email-rejection-settings-shared";
import {
  tenantLegalPagesCacheTag,
  updateTenantLegalPages,
} from "#lib/tenant-legal-pages";
import { updateTenantLocales } from "#lib/tenant-locales";
import { updateTenantTimezone } from "#lib/tenant-timezone";

import type {
  EmailChangeActionState,
  SiteSettingsActionState,
  TenantAgeVerificationActionState,
  TenantCommentSettingsActionState,
  TenantEmailRejectionActionState,
  TenantLegalPagesActionState,
  TenantLocalesActionState,
  TenantTimezoneActionState,
} from "../settings-types";

/**
 * The Go server validates against the IANA tzdata it embeds
 * (`server/internal/tenanttz`) and stays the authority; this only gives the
 * operator immediate feedback instead of a round trip.
 */
const tenantTimezoneSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    timezone: z
      .string({
        error: t("admin.settings.timezone.validation.required"),
      })
      .trim()
      .min(1, t("admin.settings.timezone.validation.required"))
      .refine(isValidTimeZone, {
        error: t("admin.settings.timezone.validation.invalid"),
      }),
  });
};
/**
 * The Go server validates against the supported locale list
 * (`server/internal/locale`) and refuses a set without the default, and stays
 * the authority; this only gives the operator immediate feedback instead of a
 * round trip. The form keeps the default's box ticked and sends it as an entry
 * of its own, so a set that leaves it out was not sent by the form.
 */
const tenantLocalesSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      defaultLocale: z.enum(getLocales(), {
        error: t("admin.settings.locales.validation.required"),
      }),
      supportedLocales: z.array(
        z.enum(getLocales(), {
          error: t("admin.settings.locales.validation.supported_invalid"),
        })
      ),
    })
    .refine((value) => value.supportedLocales.includes(value.defaultLocale), {
      error: t("admin.settings.locales.validation.default_not_offered"),
      path: ["supportedLocales"],
    });
};
/**
 * The Go server validates what it is sent and stays the authority; this only
 * gives the operator immediate feedback instead of a round trip.
 *
 * The threshold arrives as the text of a number input, which a browser leaves
 * as whatever was typed. It is parsed here rather than coerced, so "3.5" and
 * "many" are told apart from a count and reported instead of being rounded or
 * read as 0 — the value that turns the automatic removal off.
 */
const tenantCommentSettingsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const thresholdError = t(
    "admin.settings.comments.validation.auto_hide_range",
    { max: MAX_TENANT_COMMENT_AUTO_HIDE_REPORT_THRESHOLD }
  );

  return z.object({
    autoHideReportThreshold: z
      .string()
      .trim()
      .regex(/^\d+$/u, { error: thresholdError })
      .transform(Number)
      .refine(
        (value) => value <= MAX_TENANT_COMMENT_AUTO_HIDE_REPORT_THRESHOLD,
        { error: thresholdError }
      ),
    commentMode: z.enum(TENANT_COMMENT_MODES, {
      error: t("admin.settings.comments.validation.mode_required"),
    }),
  });
};

const tenantAgeVerificationSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    ageVerification: z.enum(TENANT_AGE_VERIFICATIONS, {
      error: t("admin.settings.age_verification.validation.required"),
    }),
  });
};

/**
 * Each nomination is empty, which clears it, or a page id. Whether that page is
 * a published page of the tenant is the server's check.
 */
const tenantLegalPagesSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const error = t("admin.settings.legal_pages.validation.page_invalid");
  const pageId = z
    .string({ error })
    .trim()
    .pipe(z.union([z.literal(""), z.uuid({ error })], { error }));

  return z.object({
    privacyPageId: pageId,
    termsPageId: pageId,
  });
};

/**
 * The list arrives as one `entries` field per input, blank ones included, and
 * is checked entry by entry with the rule the settings card applies as each
 * field is left — the server's own, so a list this accepts is one the server
 * accepts. The switch is a checkbox, present only while it is on.
 */
const tenantEmailRejectionSchema = async (locale: Locale) => {
  const [t, tenantId] = await Promise.all([
    getMessagesFor(locale),
    tenantIdFormSchema(locale),
  ]);

  return z.object({
    entries: z.array(z.string()).transform((values, context) => {
      const result = parseEmailRejectionEntries(values);
      if (result.ok) {
        return result.entries;
      }
      context.addIssue({
        code: "custom",
        message:
          result.reason === "too_many"
            ? t("admin.settings.email_rejection.validation.too_many", {
                max: MAX_EMAIL_REJECTION_ENTRIES,
              })
            : t("admin.settings.email_rejection.validation.entry_invalid", {
                entry: result.entry,
              }),
      });
      return z.NEVER;
    }),
    rejectDisposableDomains: z
      .literal("on")
      .optional()
      .transform((value) => value === "on"),
    tenantId,
  });
};

/**
 * The language whose copy the card saves. Blank, or absent, writes the default
 * language, which is what the API takes an absent one for and what the card
 * edits when the site's languages cannot be read.
 */
const siteTranslationLocaleSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.enum(getLocales()).optional()
);

export const updateSiteSettingsAction = async (
  _prevState: SiteSettingsActionState,
  formData: FormData
): Promise<SiteSettingsActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const copyrightText = String(formData.get("copyright_text") ?? "");
  const siteDescription = String(formData.get("site_description") ?? "");
  const siteTagline = String(formData.get("site_tagline") ?? "");
  const translationLocale = siteTranslationLocaleSchema.safeParse(
    formData.get("translation_locale")
  );

  if (!tenantId) {
    return {
      message: t("admin.settings.tenant_missing"),
      ok: false,
    };
  }
  if (!translationLocale.success) {
    return {
      message: t("admin.settings.site.locale_not_offered"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantSiteSettings(
      {
        copyrightText,
        siteDescription,
        siteTagline,
        tenantId,
        translationLocale: translationLocale.data,
      },
      locale
    )
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(tenantSiteSettingsCacheTag(tenantId));

  return {
    message: t("admin.settings.site.saved"),
    ok: true,
  };
};

export const updateTenantTimezoneAction = async (
  _prevState: TenantTimezoneActionState,
  formData: FormData
): Promise<TenantTimezoneActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) {
    return {
      message: t("admin.settings.tenant_missing"),
      ok: false,
    };
  }

  const schema = await tenantTimezoneSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, { timezone: "value" })
  );
  if (!parsed.success) {
    // One control, so the field message is the form message.
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantTimezone(
      {
        tenantId,
        timezone: parsed.data.timezone,
      },
      locale
    )
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  // The settings screen reads the time zone through a private cache, so without
  // this the operator would keep seeing the previous value in the same session.
  updateTag(tenantSiteCacheTag(tenantId));

  return {
    message: t("admin.settings.timezone.saved"),
    ok: true,
  };
};

export const updateTenantLocalesAction = async (
  _prevState: TenantLocalesActionState,
  formData: FormData
): Promise<TenantLocalesActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) {
    return {
      message: t("admin.settings.tenant_missing"),
      ok: false,
    };
  }

  const schema = await tenantLocalesSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      defaultLocale: { kind: "value", name: "default_locale" },
      supportedLocales: { kind: "values", name: "supported_locales" },
    })
  );
  if (!parsed.success) {
    // The two controls answer for one setting, so the message is the form's.
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantLocales(
      {
        defaultLocale: parsed.data.defaultLocale,
        supportedLocales: parsed.data.supportedLocales,
        tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  // The settings screen, the page editor's language tabs, and cookie-less
  // `getLocale()` read the languages through a private cache, so without this
  // the operator would keep seeing the previous values in the same session.
  updateTag(tenantSiteCacheTag(tenantId));

  return {
    message: t("admin.settings.locales.saved"),
    ok: true,
  };
};

export const updateTenantCommentSettingsAction = async (
  _prevState: TenantCommentSettingsActionState,
  formData: FormData
): Promise<TenantCommentSettingsActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) {
    return {
      message: t("admin.settings.tenant_missing"),
      ok: false,
    };
  }

  const schema = await tenantCommentSettingsSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      autoHideReportThreshold: {
        kind: "value",
        name: "auto_hide_report_threshold",
      },
      commentMode: { kind: "value", name: "comment_mode" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantCommentSettings(
      {
        autoHideReportThreshold: parsed.data.autoHideReportThreshold,
        commentMode: parsed.data.commentMode,
        tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  // The settings screen reads these through a private cache, so without this
  // the operator would keep seeing the previous choice in the same session. The
  // storefront's own cached copy is dropped by the API as the update lands.
  updateTag(tenantCommentSettingsCacheTag(tenantId));

  return {
    message: t("admin.settings.comments.saved"),
    ok: true,
  };
};

export const updateTenantAgeVerificationAction = async (
  _prevState: TenantAgeVerificationActionState,
  formData: FormData
): Promise<TenantAgeVerificationActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) {
    return {
      message: t("admin.settings.tenant_missing"),
      ok: false,
    };
  }

  const schema = await tenantAgeVerificationSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      ageVerification: { kind: "value", name: "age_verification" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantAgeVerification(
      { ageVerification: parsed.data.ageVerification, tenantId },
      locale
    )
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  // The settings screen reads the rule through a private cache, so without this
  // the operator would keep seeing the previous choice in the same session. The
  // storefront's own cached copies are dropped by the API as the update lands.
  updateTag(tenantAgeVerificationCacheTag(tenantId));

  return {
    message: t("admin.settings.age_verification.saved"),
    ok: true,
  };
};

export const updateTenantLegalPagesAction = async (
  _prevState: TenantLegalPagesActionState,
  formData: FormData
): Promise<TenantLegalPagesActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) {
    return {
      message: t("admin.settings.tenant_missing"),
      ok: false,
    };
  }

  const schema = await tenantLegalPagesSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      privacyPageId: { kind: "value", name: "privacy_page_id" },
      termsPageId: { kind: "value", name: "terms_page_id" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantLegalPages(
      {
        privacyPageId: parsed.data.privacyPageId,
        tenantId,
        termsPageId: parsed.data.termsPageId,
      },
      locale
    )
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  // The settings screen reads the nominations through a private cache. The
  // storefront's own cached copy is dropped by the API as the update lands.
  updateTag(tenantLegalPagesCacheTag(tenantId));

  return {
    message: t("admin.settings.legal_pages.saved"),
    ok: true,
  };
};

export const updateTenantEmailRejectionAction = async (
  _prevState: TenantEmailRejectionActionState,
  formData: FormData
): Promise<TenantEmailRejectionActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    tenantEmailRejectionSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      entries: "values",
      rejectDisposableDomains: {
        kind: "value",
        name: "reject_disposable_domains",
      },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    const fieldErrors = toFieldErrors(parsed.error);
    return {
      fieldErrors: { entries: fieldErrors.entries },
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const { entries, rejectDisposableDomains, tenantId } = parsed.data;
  const result = await withAdminSessionReauth(() =>
    updateTenantEmailRejectionSettings(
      { entries, rejectDisposableDomains, tenantId },
      locale
    )
  );

  if (!result.ok) {
    return {
      fieldErrors: result.entriesError
        ? { entries: result.entriesError }
        : undefined,
      message: result.message,
      ok: false,
    };
  }

  // The settings screen reads the setting through a private cache, so without
  // this the operator would keep seeing the previous list in the same session.
  // The storefront reads it in the API on every sign-up, through no cache.
  updateTag(tenantEmailRejectionSettingsCacheTag(tenantId));

  return {
    disposableDomainListAvailable: result.disposableDomainListAvailable,
    message: t("admin.settings.email_rejection.saved"),
    ok: true,
    settings: result.settings,
  };
};

export const requestEmailChangeAction = async (
  _prevState: EmailChangeActionState,
  formData: FormData
): Promise<EmailChangeActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const currentEmail = String(formData.get("current_email") ?? "").trim();
  const newEmail = String(formData.get("new_email") ?? "").trim();
  const currentPassword = String(formData.get("current_password") ?? "");

  if (!tenantId) {
    return {
      message: t("admin.settings.tenant_missing"),
      ok: false,
    };
  }

  if (!currentEmail || !newEmail || !currentPassword) {
    return {
      message: t("admin.settings.email_change.all_fields_required"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    requestAdminEmailChange(
      tenantId,
      currentEmail,
      newEmail,
      currentPassword,
      locale
    )
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  return {
    message: t("admin.settings.email_change.requested"),
    ok: true,
  };
};
