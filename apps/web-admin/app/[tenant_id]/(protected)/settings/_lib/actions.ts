"use server";

import { getLocales } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { isValidTimeZone } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { requestAdminEmailChange } from "#lib/admin-auth";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { getMessagesFor } from "#lib/messages";
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
  tenantDefaultLocaleCacheTag,
  updateTenantDefaultLocale,
} from "#lib/tenant-default-locale";
import {
  tenantLegalPagesCacheTag,
  updateTenantLegalPages,
} from "#lib/tenant-legal-pages";
import {
  tenantTimezoneCacheTag,
  updateTenantTimezone,
} from "#lib/tenant-timezone";

import type {
  EmailChangeActionState,
  SiteSettingsActionState,
  TenantAgeVerificationActionState,
  TenantCommentSettingsActionState,
  TenantDefaultLocaleActionState,
  TenantLegalPagesActionState,
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
 * (`server/internal/locale`) and stays the authority; this only gives the
 * operator immediate feedback instead of a round trip.
 */
const tenantDefaultLocaleSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    defaultLocale: z.enum(getLocales(), {
      error: t("admin.settings.default_locale.validation.required"),
    }),
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

  if (!tenantId) {
    return {
      message: t("admin.settings.tenant_missing"),
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
  updateTag(tenantTimezoneCacheTag(tenantId));

  return {
    message: t("admin.settings.timezone.saved"),
    ok: true,
    timezone: result.timezone,
  };
};

export const updateTenantDefaultLocaleAction = async (
  _prevState: TenantDefaultLocaleActionState,
  formData: FormData
): Promise<TenantDefaultLocaleActionState> => {
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

  const schema = await tenantDefaultLocaleSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      defaultLocale: { kind: "value", name: "default_locale" },
    })
  );
  if (!parsed.success) {
    // One control, so the field message is the form message.
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantDefaultLocale(
      {
        defaultLocale: parsed.data.defaultLocale,
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

  // The settings screen and cookie-less `getLocale()` read the default
  // through a private cache, so without this the operator would keep seeing
  // the previous value in the same session.
  updateTag(tenantDefaultLocaleCacheTag(tenantId));

  return {
    defaultLocale: result.defaultLocale,
    message: t("admin.settings.default_locale.saved"),
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
    autoHideReportThreshold: result.autoHideReportThreshold,
    commentMode: result.commentMode,
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
    ageVerification: result.ageVerification,
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
