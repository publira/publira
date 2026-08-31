"use server";

import { getLocales, getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { isValidTimeZone } from "@publira/utils";
import { toFieldErrors, toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import {
  findThemeTextContrastIssues,
  THEME_TEXT_CONTRAST_MIN_RATIO,
} from "@publira/utils/theme-contrast";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { requestAdminEmailChange } from "#lib/admin-auth";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  sendTenantSmtpTestEmail,
  updateTenantEmailSettings,
} from "#lib/email-settings";
import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "#lib/email-settings-shared";
import {
  checkboxOnFormSchema,
  flagOneFormSchema,
  requiredTrimmedString,
} from "#lib/form-schemas";
import type { AdminMessageKey } from "#lib/locale";
import {
  tenantPaymentSettingsCacheTag,
  updateTenantPaymentSettings,
} from "#lib/payment-settings";
import { updateTenantSiteSettings } from "#lib/site-settings";
import {
  tenantDefaultLocaleCacheTag,
  updateTenantDefaultLocale,
} from "#lib/tenant-default-locale";
import {
  tenantTimezoneCacheTag,
  updateTenantTimezone,
} from "#lib/tenant-timezone";
import {
  deleteTenantIcon,
  deleteTenantLogo,
  tenantThemeCacheTag,
  updateTenantThemeSettings,
  uploadTenantIcon,
  uploadTenantLogo,
} from "#lib/theme-settings";

import type {
  EmailChangeActionState,
  SiteSettingsActionState,
  TenantDefaultLocaleActionState,
  TenantEmailSettingsFormState,
  TenantIconActionState,
  TenantLogoActionState,
  TenantPaymentSettingsFormState,
  TenantSmtpTestFormState,
  TenantTimezoneActionState,
  ThemeSettingsActionState,
  ThemeSettingsFieldErrors,
} from "../settings-types";

interface ParsedTenantSmtpFormData {
  tenantId: string;
  smtpOverrideEnabled: boolean;
  host: string;
  port: number;
  username: string;
  passwordUpdateMode: number;
  password: string;
  encryption: string;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  recipientType: number;
  recipientEmail: string;
}

const hexColorCodeSchema = (messages: SharedMessages) =>
  z
    .string()
    .trim()
    .regex(
      /^#[0-9a-fA-F]{6}$/u,
      getMessage(messages, "admin.settings.theme.validation.hex_color")
    )
    .transform((value) => value.toLowerCase());

const tenantThemeSchema = (messages: SharedMessages) =>
  z.object({
    accentColor: hexColorCodeSchema(messages),
    accentForegroundColor: hexColorCodeSchema(messages),
    backgroundColor: hexColorCodeSchema(messages),
    borderColor: hexColorCodeSchema(messages),
    cardColor: hexColorCodeSchema(messages),
    cardForegroundColor: hexColorCodeSchema(messages),
    destructiveColor: hexColorCodeSchema(messages),
    destructiveForegroundColor: hexColorCodeSchema(messages),
    foregroundColor: hexColorCodeSchema(messages),
    infoColor: hexColorCodeSchema(messages),
    infoForegroundColor: hexColorCodeSchema(messages),
    inputColor: hexColorCodeSchema(messages),
    mutedColor: hexColorCodeSchema(messages),
    mutedForegroundColor: hexColorCodeSchema(messages),
    popoverColor: hexColorCodeSchema(messages),
    popoverForegroundColor: hexColorCodeSchema(messages),
    primaryColor: hexColorCodeSchema(messages),
    primaryForegroundColor: hexColorCodeSchema(messages),
    ringColor: hexColorCodeSchema(messages),
    secondaryColor: hexColorCodeSchema(messages),
    secondaryForegroundColor: hexColorCodeSchema(messages),
    successColor: hexColorCodeSchema(messages),
    successForegroundColor: hexColorCodeSchema(messages),
    surfaceColor: hexColorCodeSchema(messages),
    surfaceForegroundColor: hexColorCodeSchema(messages),
    warningColor: hexColorCodeSchema(messages),
    warningForegroundColor: hexColorCodeSchema(messages),
  });

const themeColorLabelKeys: Record<
  keyof z.output<ReturnType<typeof tenantThemeSchema>>,
  AdminMessageKey
> = {
  accentColor: "admin.settings.theme.colors.accent.label",
  accentForegroundColor: "admin.settings.theme.colors.accent_foreground.label",
  backgroundColor: "admin.settings.theme.colors.background.label",
  borderColor: "admin.settings.theme.colors.border.label",
  cardColor: "admin.settings.theme.colors.card.label",
  cardForegroundColor: "admin.settings.theme.colors.card_foreground.label",
  destructiveColor: "admin.settings.theme.colors.destructive.label",
  destructiveForegroundColor:
    "admin.settings.theme.colors.destructive_foreground.label",
  foregroundColor: "admin.settings.theme.colors.foreground.label",
  infoColor: "admin.settings.theme.colors.info.label",
  infoForegroundColor: "admin.settings.theme.colors.info_foreground.label",
  inputColor: "admin.settings.theme.colors.input.label",
  mutedColor: "admin.settings.theme.colors.muted.label",
  mutedForegroundColor: "admin.settings.theme.colors.muted_foreground.label",
  popoverColor: "admin.settings.theme.colors.popover.label",
  popoverForegroundColor:
    "admin.settings.theme.colors.popover_foreground.label",
  primaryColor: "admin.settings.theme.colors.primary.label",
  primaryForegroundColor:
    "admin.settings.theme.colors.primary_foreground.label",
  ringColor: "admin.settings.theme.colors.ring.label",
  secondaryColor: "admin.settings.theme.colors.secondary.label",
  secondaryForegroundColor:
    "admin.settings.theme.colors.secondary_foreground.label",
  successColor: "admin.settings.theme.colors.success.label",
  successForegroundColor:
    "admin.settings.theme.colors.success_foreground.label",
  surfaceColor: "admin.settings.theme.colors.surface.label",
  surfaceForegroundColor:
    "admin.settings.theme.colors.surface_foreground.label",
  warningColor: "admin.settings.theme.colors.warning.label",
  warningForegroundColor:
    "admin.settings.theme.colors.warning_foreground.label",
};

/**
 * The icon and the logo accept the same file. They differ in how the server
 * normalizes what it is given — a square crop for the icon, the source aspect
 * ratio kept for the logo — not in what it takes, so the two are one schema
 * rather than two that have to be kept identical by hand.
 *
 * The Go server re-checks all of this and stays the authority. Checking size and
 * type here keeps a rejected file from being read into memory and shipped over
 * the RPC first — the `accept` attribute constrains the file picker, not a
 * request someone posts directly.
 */
const BRANDING_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const BRANDING_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const brandingImageFileSchema = (messages: SharedMessages) =>
  z
    .custom<File>((value) => value instanceof File, {
      error: getMessage(messages, "admin.settings.image.file_required"),
    })
    .refine((file) => file.size <= BRANDING_IMAGE_MAX_BYTES, {
      error: getMessage(messages, "admin.settings.image.too_large"),
    })
    .refine((file) => BRANDING_IMAGE_CONTENT_TYPES.has(file.type), {
      error: getMessage(messages, "admin.settings.image.unsupported_type"),
    });

/**
 * Upload and delete share one Action so the card renders the current icon
 * straight from the Action state: with a state per operation there is no way to
 * tell which of the two ran last.
 */
const tenantIconSchema = (messages: SharedMessages) =>
  z.discriminatedUnion("intent", [
    z.object({
      icon: brandingImageFileSchema(messages),
      intent: z.literal("upload"),
      tenantId: requiredTrimmedString(
        getMessage(messages, "admin.settings.tenant_missing")
      ),
    }),
    z.object({
      intent: z.literal("delete"),
      tenantId: requiredTrimmedString(
        getMessage(messages, "admin.settings.tenant_missing")
      ),
    }),
  ]);

/** Upload and delete share one Action, for the reason the icon's does. */
const tenantLogoSchema = (messages: SharedMessages) =>
  z.discriminatedUnion("intent", [
    z.object({
      intent: z.literal("upload"),
      logo: brandingImageFileSchema(messages),
      tenantId: requiredTrimmedString(
        getMessage(messages, "admin.settings.tenant_missing")
      ),
    }),
    z.object({
      intent: z.literal("delete"),
      tenantId: requiredTrimmedString(
        getMessage(messages, "admin.settings.tenant_missing")
      ),
    }),
  ]);

/**
 * The Go server validates against the IANA tzdata it embeds
 * (`server/internal/tenanttz`) and stays the authority; this only gives the
 * operator immediate feedback instead of a round trip.
 */
const tenantTimezoneSchema = (messages: SharedMessages) =>
  z.object({
    timezone: z
      .string({
        error: getMessage(
          messages,
          "admin.settings.timezone.validation.required"
        ),
      })
      .trim()
      .min(
        1,
        getMessage(messages, "admin.settings.timezone.validation.required")
      )
      .refine(isValidTimeZone, {
        error: getMessage(
          messages,
          "admin.settings.timezone.validation.invalid"
        ),
      }),
  });

/**
 * The Go server validates against the supported locale list
 * (`server/internal/locale`) and stays the authority; this only gives the
 * operator immediate feedback instead of a round trip.
 */
const tenantDefaultLocaleSchema = (messages: SharedMessages) =>
  z.object({
    defaultLocale: z.enum(getLocales(), {
      error: getMessage(
        messages,
        "admin.settings.default_locale.validation.required"
      ),
    }),
  });

const tenantThemeFormFieldMap = [
  ["accentColor", "accent_color"],
  ["accentForegroundColor", "accent_foreground_color"],
  ["backgroundColor", "background_color"],
  ["borderColor", "border_color"],
  ["cardColor", "card_color"],
  ["cardForegroundColor", "card_foreground_color"],
  ["destructiveColor", "destructive_color"],
  ["destructiveForegroundColor", "destructive_foreground_color"],
  ["foregroundColor", "foreground_color"],
  ["infoColor", "info_color"],
  ["infoForegroundColor", "info_foreground_color"],
  ["inputColor", "input_color"],
  ["mutedColor", "muted_color"],
  ["mutedForegroundColor", "muted_foreground_color"],
  ["popoverColor", "popover_color"],
  ["popoverForegroundColor", "popover_foreground_color"],
  ["primaryColor", "primary_color"],
  ["primaryForegroundColor", "primary_foreground_color"],
  ["ringColor", "ring_color"],
  ["secondaryColor", "secondary_color"],
  ["secondaryForegroundColor", "secondary_foreground_color"],
  ["successColor", "success_color"],
  ["successForegroundColor", "success_foreground_color"],
  ["surfaceColor", "surface_color"],
  ["surfaceForegroundColor", "surface_foreground_color"],
  ["warningColor", "warning_color"],
  ["warningForegroundColor", "warning_foreground_color"],
] as const;

type TenantThemeSchemaInput = z.input<ReturnType<typeof tenantThemeSchema>>;

const parseTenantThemeFormData = (formData: FormData): TenantThemeSchemaInput =>
  Object.fromEntries(
    tenantThemeFormFieldMap.map(([field, formName]) => [
      field,
      String(formData.get(formName) ?? ""),
    ])
  ) as TenantThemeSchemaInput;

const mapThemeFieldErrors = (
  fieldErrors: z.ZodFlattenedError<TenantThemeSchemaInput>["fieldErrors"]
): ThemeSettingsFieldErrors =>
  Object.fromEntries(
    tenantThemeFormFieldMap.map(([field]) => [field, fieldErrors[field]?.[0]])
  ) as ThemeSettingsFieldErrors;

const mapThemeContrastFieldErrors = (
  issues: ReturnType<typeof findThemeTextContrastIssues>,
  messages: SharedMessages
): ThemeSettingsFieldErrors =>
  Object.fromEntries(
    issues.flatMap((issue) => {
      const message = getMessage(
        messages,
        "admin.settings.theme.validation.contrast",
        {
          actual: issue.ratio.toFixed(2),
          background: getMessage(
            messages,
            themeColorLabelKeys[issue.background]
          ),
          foreground: getMessage(
            messages,
            themeColorLabelKeys[issue.foreground]
          ),
          minimum: String(THEME_TEXT_CONTRAST_MIN_RATIO),
        }
      );
      return [
        [issue.background, message],
        [issue.foreground, message],
      ];
    })
  ) as ThemeSettingsFieldErrors;

const parseIntOrFallback = (value: string, fallback: number): number => {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
};

const parseSecretUpdateMode = (value: string): number => {
  const parsed = parseIntOrFallback(value, SECRET_UPDATE_MODE_UNCHANGED);
  if (parsed === SECRET_UPDATE_MODE_REPLACE) {
    return SECRET_UPDATE_MODE_REPLACE;
  }

  return SECRET_UPDATE_MODE_UNCHANGED;
};

const parseRecipientType = (value: string): number => {
  const parsed = parseIntOrFallback(value, TEST_EMAIL_RECIPIENT_TYPE_SELF);
  if (parsed === TEST_EMAIL_RECIPIENT_TYPE_CUSTOM) {
    return TEST_EMAIL_RECIPIENT_TYPE_CUSTOM;
  }

  return TEST_EMAIL_RECIPIENT_TYPE_SELF;
};

const parseTenantSmtpFormData = (
  formData: FormData
): ParsedTenantSmtpFormData => ({
  encryption: String(formData.get("encryption") ?? "")
    .trim()
    .toLowerCase(),
  fromAddress: String(formData.get("from_address") ?? "").trim(),
  fromName: String(formData.get("from_name") ?? "").trim(),
  host: String(formData.get("host") ?? "").trim(),
  password: String(formData.get("password") ?? ""),
  passwordUpdateMode: parseSecretUpdateMode(
    String(formData.get("password_update_mode") ?? "")
  ),
  port: parseIntOrFallback(String(formData.get("port") ?? "587"), 587),
  recipientEmail: String(formData.get("recipient_email") ?? "").trim(),
  recipientType: parseRecipientType(
    String(formData.get("recipient_type") ?? "")
  ),
  replyTo: String(formData.get("reply_to") ?? "").trim(),
  smtpOverrideEnabled: formData.get("smtp_override_enabled") === "on",
  tenantId: String(formData.get("tenant_id") ?? "").trim(),
  username: String(formData.get("username") ?? "").trim(),
});

export const updateSiteSettingsAction = async (
  _prevState: SiteSettingsActionState,
  formData: FormData
): Promise<SiteSettingsActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const copyrightText = String(formData.get("copyright_text") ?? "");
  const siteDescription = String(formData.get("site_description") ?? "");
  const siteTagline = String(formData.get("site_tagline") ?? "");

  if (!tenantId) {
    return {
      message: getMessage(messages, "admin.settings.tenant_missing"),
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

  return {
    message: getMessage(messages, "admin.settings.site.saved"),
    ok: true,
  };
};

export const updateTenantThemeSettingsAction = async (
  _prevState: ThemeSettingsActionState,
  formData: FormData
): Promise<ThemeSettingsActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) {
    return {
      message: getMessage(messages, "admin.settings.tenant_missing"),
      ok: false,
    };
  }

  const parsed = tenantThemeSchema(messages).safeParse(
    parseTenantThemeFormData(formData)
  );

  if (!parsed.success) {
    return {
      fieldErrors: mapThemeFieldErrors(parsed.error.flatten().fieldErrors),
      message: getMessage(messages, "errors.validation"),
      ok: false,
    };
  }

  const contrastIssues = findThemeTextContrastIssues(parsed.data);
  if (contrastIssues.length > 0) {
    return {
      fieldErrors: mapThemeContrastFieldErrors(contrastIssues, messages),
      message: getMessage(
        messages,
        "admin.settings.theme.validation.contrast_summary"
      ),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantThemeSettings(
      {
        ...parsed.data,
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

  // Refresh SSR theme injection for this admin app (public GetTenant cache).
  updateTag(`tenant:${tenantId}:site`);
  updateTag(tenantThemeCacheTag(tenantId));

  return {
    message: getMessage(messages, "admin.settings.theme.saved"),
    ok: true,
    theme: result.theme,
  };
};

export const updateTenantIconAction = async (
  _prevState: TenantIconActionState,
  formData: FormData
): Promise<TenantIconActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const parsed = tenantIconSchema(messages).safeParse(
    toFormDataInput(formData, {
      icon: { kind: "file", name: "icon" },
      intent: { kind: "value", name: "intent" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    // One control, so the field message is the form message.
    return {
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const input = parsed.data;
  const isDelete = input.intent === "delete";

  // The file is read into memory inside the callback, so an unauthorized caller
  // never gets a 10MB upload buffered on its behalf.
  const result = await withAdminSessionReauth(async () => {
    if (input.intent === "delete") {
      return deleteTenantIcon(input.tenantId, locale);
    }

    return uploadTenantIcon(
      {
        iconContentType: input.icon.type,
        iconData: new Uint8Array(await input.icon.arrayBuffer()),
        tenantId: input.tenantId,
      },
      locale
    );
  });

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  // Refresh the public site's tenant read and this screen's own private cache.
  updateTag(`tenant:${input.tenantId}:site`);
  updateTag(tenantThemeCacheTag(input.tenantId));

  return {
    icon: result.icon,
    message: getMessage(
      messages,
      isDelete ? "admin.settings.icon.deleted" : "admin.settings.icon.saved"
    ),
    ok: true,
  };
};

export const updateTenantLogoAction = async (
  _prevState: TenantLogoActionState,
  formData: FormData
): Promise<TenantLogoActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const parsed = tenantLogoSchema(messages).safeParse(
    toFormDataInput(formData, {
      intent: { kind: "value", name: "intent" },
      logo: { kind: "file", name: "logo" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    // One control, so the field message is the form message.
    return {
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const input = parsed.data;
  const isDelete = input.intent === "delete";

  // The file is read into memory inside the callback, so an unauthorized caller
  // never gets a 10MB upload buffered on its behalf.
  const result = await withAdminSessionReauth(async () => {
    if (input.intent === "delete") {
      return deleteTenantLogo(input.tenantId, locale);
    }

    return uploadTenantLogo(
      {
        logoContentType: input.logo.type,
        logoData: new Uint8Array(await input.logo.arrayBuffer()),
        tenantId: input.tenantId,
      },
      locale
    );
  });

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  // Refresh the public site's tenant read and this screen's own private cache.
  updateTag(`tenant:${input.tenantId}:site`);
  updateTag(tenantThemeCacheTag(input.tenantId));

  return {
    logo: result.logo,
    message: getMessage(
      messages,
      isDelete ? "admin.settings.logo.deleted" : "admin.settings.logo.saved"
    ),
    ok: true,
  };
};

export const updateTenantTimezoneAction = async (
  _prevState: TenantTimezoneActionState,
  formData: FormData
): Promise<TenantTimezoneActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) {
    return {
      message: getMessage(messages, "admin.settings.tenant_missing"),
      ok: false,
    };
  }

  const parsed = tenantTimezoneSchema(messages).safeParse(
    toFormDataInput(formData, { timezone: "value" })
  );
  if (!parsed.success) {
    // One control, so the field message is the form message.
    return {
      message: toFormErrorMessage(parsed.error),
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
    message: getMessage(messages, "admin.settings.timezone.saved"),
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
  const messages = sharedCatalog(locale);
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) {
    return {
      message: getMessage(messages, "admin.settings.tenant_missing"),
      ok: false,
    };
  }

  const parsed = tenantDefaultLocaleSchema(messages).safeParse(
    toFormDataInput(formData, {
      defaultLocale: { kind: "value", name: "default_locale" },
    })
  );
  if (!parsed.success) {
    // One control, so the field message is the form message.
    return {
      message: toFormErrorMessage(parsed.error),
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
    message: getMessage(messages, "admin.settings.default_locale.saved"),
    ok: true,
  };
};

const optionalSecretSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : ""),
  z.string()
);

const tenantPaymentSettingsSchema = (messages: SharedMessages) =>
  z
    .object({
      enabled: checkboxOnFormSchema,
      secretKey: optionalSecretSchema,
      secretKeyConfigured: flagOneFormSchema,
      tenantId: requiredTrimmedString(
        getMessage(messages, "admin.settings.tenant_missing")
      ),
      webhookSecret: optionalSecretSchema,
      webhookSecretConfigured: flagOneFormSchema,
    })
    .superRefine((value, ctx) => {
      if (!value.enabled) {
        return;
      }
      if (!value.secretKeyConfigured && value.secretKey.trim() === "") {
        ctx.addIssue({
          code: "custom",
          message: getMessage(
            messages,
            "admin.settings.payment.validation.secret_key_required"
          ),
          path: ["secretKey"],
        });
      }
      if (!value.webhookSecretConfigured && value.webhookSecret.trim() === "") {
        ctx.addIssue({
          code: "custom",
          message: getMessage(
            messages,
            "admin.settings.payment.validation.webhook_secret_required"
          ),
          path: ["webhookSecret"],
        });
      }
    });

const tenantPaymentSettingsFormFields = {
  enabled: "value",
  secretKey: { kind: "value", name: "secret_key" },
  secretKeyConfigured: { kind: "value", name: "secret_key_configured" },
  tenantId: { kind: "value", name: "tenant_id" },
  webhookSecret: { kind: "value", name: "webhook_secret" },
  webhookSecretConfigured: {
    kind: "value",
    name: "webhook_secret_configured",
  },
} as const;

const secretUpdateMode = (value: string): number =>
  value.trim() === ""
    ? SECRET_UPDATE_MODE_UNCHANGED
    : SECRET_UPDATE_MODE_REPLACE;

export const updateTenantPaymentSettingsAction = async (
  _prevState: TenantPaymentSettingsFormState,
  formData: FormData
): Promise<TenantPaymentSettingsFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const parsed = tenantPaymentSettingsSchema(messages).safeParse(
    toFormDataInput(formData, tenantPaymentSettingsFormFields)
  );
  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error),
      message: getMessage(messages, "errors.validation"),
      ok: false,
    };
  }

  const secretKey = parsed.data.secretKey.trim();
  const webhookSecret = parsed.data.webhookSecret.trim();

  const result = await withAdminSessionReauth(() =>
    updateTenantPaymentSettings(
      {
        enabled: parsed.data.enabled,
        secretKey,
        secretKeyUpdateMode: secretUpdateMode(secretKey),
        tenantId: parsed.data.tenantId,
        webhookSecret,
        webhookSecretUpdateMode: secretUpdateMode(webhookSecret),
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

  updateTag(tenantPaymentSettingsCacheTag(parsed.data.tenantId));

  return {
    message: getMessage(messages, "admin.settings.payment.saved"),
    ok: true,
    settings: result.settings,
  };
};

export const updateTenantEmailSettingsAction = async (
  _prevState: TenantEmailSettingsFormState,
  formData: FormData
): Promise<TenantEmailSettingsFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const input = parseTenantSmtpFormData(formData);

  if (!input.tenantId) {
    return {
      message: getMessage(messages, "admin.settings.tenant_missing"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantEmailSettings(input, locale)
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  return {
    message: getMessage(messages, "admin.settings.email.saved"),
    ok: true,
    settings: result.settings,
  };
};

export const sendTenantSmtpTestEmailAction = async (
  _prevState: TenantSmtpTestFormState,
  formData: FormData
): Promise<TenantSmtpTestFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const input = parseTenantSmtpFormData(formData);

  if (!input.tenantId) {
    return {
      message: getMessage(messages, "admin.settings.tenant_missing"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    sendTenantSmtpTestEmail(input, locale)
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  return {
    message: getMessage(messages, "admin.settings.email.test_sent", {
      recipient: result.recipientEmail,
    }),
    ok: true,
    recipientEmail: result.recipientEmail,
  };
};

export const requestEmailChangeAction = async (
  _prevState: EmailChangeActionState,
  formData: FormData
): Promise<EmailChangeActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const messages = sharedCatalog(locale);
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const currentEmail = String(formData.get("current_email") ?? "").trim();
  const newEmail = String(formData.get("new_email") ?? "").trim();
  const currentPassword = String(formData.get("current_password") ?? "");

  if (!tenantId) {
    return {
      message: getMessage(messages, "admin.settings.tenant_missing"),
      ok: false,
    };
  }

  if (!currentEmail || !newEmail || !currentPassword) {
    return {
      message: getMessage(
        messages,
        "admin.settings.email_change.all_fields_required"
      ),
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
    message: getMessage(messages, "admin.settings.email_change.requested"),
    ok: true,
  };
};
