"use server";

import type { Locale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import {
  findThemeTextContrastIssues,
  THEME_TEXT_CONTRAST_MIN_RATIO,
} from "@publira/utils/theme-contrast";
import type { ThemeContrastPair } from "@publira/utils/theme-contrast";
import { tenantThemeFontFamilySchema } from "@publira/utils/theme-css-variables";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { requiredTrimmedString } from "#lib/form-schemas";
import type { AdminMessageAccessor } from "#lib/messages";
import { getMessagesFor } from "#lib/messages";
import {
  deleteTenantIcon,
  deleteTenantLogo,
  tenantThemeCacheTag,
  updateTenantThemeSettings,
  uploadTenantIcon,
  uploadTenantLogo,
} from "#lib/theme-settings";

import type {
  TenantIconActionState,
  TenantLogoActionState,
  ThemeSettingsActionState,
  ThemeSettingsFieldErrors,
} from "../branding-types";

const hexColorCodeSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/u, t("admin.settings.theme.validation.hex_color"))
    .transform((value) => value.toLowerCase());
};
const tenantThemeSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    accentColor: await hexColorCodeSchema(locale),
    accentForegroundColor: await hexColorCodeSchema(locale),
    backgroundColor: await hexColorCodeSchema(locale),
    borderColor: await hexColorCodeSchema(locale),
    cardColor: await hexColorCodeSchema(locale),
    cardForegroundColor: await hexColorCodeSchema(locale),
    destructiveColor: await hexColorCodeSchema(locale),
    destructiveForegroundColor: await hexColorCodeSchema(locale),
    foregroundColor: await hexColorCodeSchema(locale),
    infoColor: await hexColorCodeSchema(locale),
    infoForegroundColor: await hexColorCodeSchema(locale),
    inputColor: await hexColorCodeSchema(locale),
    mutedColor: await hexColorCodeSchema(locale),
    mutedForegroundColor: await hexColorCodeSchema(locale),
    popoverColor: await hexColorCodeSchema(locale),
    popoverForegroundColor: await hexColorCodeSchema(locale),
    primaryColor: await hexColorCodeSchema(locale),
    primaryForegroundColor: await hexColorCodeSchema(locale),
    ringColor: await hexColorCodeSchema(locale),
    sansFontFamily: tenantThemeFontFamilySchema(
      t("admin.settings.theme.validation.font_family")
    ),
    secondaryColor: await hexColorCodeSchema(locale),
    secondaryForegroundColor: await hexColorCodeSchema(locale),
    serifFontFamily: tenantThemeFontFamilySchema(
      t("admin.settings.theme.validation.font_family")
    ),
    successColor: await hexColorCodeSchema(locale),
    successForegroundColor: await hexColorCodeSchema(locale),
    surfaceColor: await hexColorCodeSchema(locale),
    surfaceForegroundColor: await hexColorCodeSchema(locale),
    warningColor: await hexColorCodeSchema(locale),
    warningForegroundColor: await hexColorCodeSchema(locale),
  });
};

/**
 * The labels the two fields of a contrast pair carry on the form, keyed by the
 * pair's background. Every pair `findThemeTextContrastIssues` reports has a
 * case here; a pair it does not know is named by its field names.
 */
const themeContrastPairLabels = (
  pair: ThemeContrastPair,
  t: AdminMessageAccessor
): { background: string; foreground: string } => {
  switch (pair.background) {
    case "primaryColor": {
      return {
        background: t("admin.settings.theme.colors.primary.label"),
        foreground: t("admin.settings.theme.colors.primary_foreground.label"),
      };
    }
    case "secondaryColor": {
      return {
        background: t("admin.settings.theme.colors.secondary.label"),
        foreground: t("admin.settings.theme.colors.secondary_foreground.label"),
      };
    }
    case "accentColor": {
      return {
        background: t("admin.settings.theme.colors.accent.label"),
        foreground: t("admin.settings.theme.colors.accent_foreground.label"),
      };
    }
    case "backgroundColor": {
      return {
        background: t("admin.settings.theme.colors.background.label"),
        foreground: t("admin.settings.theme.colors.foreground.label"),
      };
    }
    case "surfaceColor": {
      return {
        background: t("admin.settings.theme.colors.surface.label"),
        foreground: t("admin.settings.theme.colors.surface_foreground.label"),
      };
    }
    case "cardColor": {
      return {
        background: t("admin.settings.theme.colors.card.label"),
        foreground: t("admin.settings.theme.colors.card_foreground.label"),
      };
    }
    case "popoverColor": {
      return {
        background: t("admin.settings.theme.colors.popover.label"),
        foreground: t("admin.settings.theme.colors.popover_foreground.label"),
      };
    }
    case "mutedColor": {
      return {
        background: t("admin.settings.theme.colors.muted.label"),
        foreground: t("admin.settings.theme.colors.muted_foreground.label"),
      };
    }
    case "successColor": {
      return {
        background: t("admin.settings.theme.colors.success.label"),
        foreground: t("admin.settings.theme.colors.success_foreground.label"),
      };
    }
    case "warningColor": {
      return {
        background: t("admin.settings.theme.colors.warning.label"),
        foreground: t("admin.settings.theme.colors.warning_foreground.label"),
      };
    }
    case "destructiveColor": {
      return {
        background: t("admin.settings.theme.colors.destructive.label"),
        foreground: t(
          "admin.settings.theme.colors.destructive_foreground.label"
        ),
      };
    }
    case "infoColor": {
      return {
        background: t("admin.settings.theme.colors.info.label"),
        foreground: t("admin.settings.theme.colors.info_foreground.label"),
      };
    }
    default: {
      return { background: pair.background, foreground: pair.foreground };
    }
  }
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

const brandingImageFileSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .custom<File>((value) => value instanceof File, {
      error: t("admin.settings.image.file_required"),
    })
    .refine((file) => file.size <= BRANDING_IMAGE_MAX_BYTES, {
      error: t("admin.settings.image.too_large"),
    })
    .refine((file) => BRANDING_IMAGE_CONTENT_TYPES.has(file.type), {
      error: t("admin.settings.image.unsupported_type"),
    });
};
/**
 * Upload and delete share one Action so the card renders the current icon
 * straight from the Action state: with a state per operation there is no way to
 * tell which of the two ran last.
 */
const tenantIconSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.discriminatedUnion("intent", [
    z.object({
      icon: await brandingImageFileSchema(locale),
      intent: z.literal("upload"),
      tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    }),
    z.object({
      intent: z.literal("delete"),
      tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    }),
  ]);
};
/** Upload and delete share one Action, for the reason the icon's does. */
const tenantLogoSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.discriminatedUnion("intent", [
    z.object({
      intent: z.literal("upload"),
      logo: await brandingImageFileSchema(locale),
      tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    }),
    z.object({
      intent: z.literal("delete"),
      tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    }),
  ]);
};

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
  ["sansFontFamily", "sans_font_family"],
  ["secondaryColor", "secondary_color"],
  ["secondaryForegroundColor", "secondary_foreground_color"],
  ["successColor", "success_color"],
  ["successForegroundColor", "success_foreground_color"],
  ["surfaceColor", "surface_color"],
  ["surfaceForegroundColor", "surface_foreground_color"],
  ["serifFontFamily", "serif_font_family"],
  ["warningColor", "warning_color"],
  ["warningForegroundColor", "warning_foreground_color"],
] as const;

type TenantThemeSchemaInput = z.input<
  Awaited<ReturnType<typeof tenantThemeSchema>>
>;

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

const mapThemeContrastFieldErrors = async (
  issues: ReturnType<typeof findThemeTextContrastIssues>,
  locale: Locale
): Promise<ThemeSettingsFieldErrors> => {
  const t = await getMessagesFor(locale);

  return Object.fromEntries(
    issues.flatMap((issue) => {
      const labels = themeContrastPairLabels(issue, t);
      const message = t("admin.settings.theme.validation.contrast", {
        actual: issue.ratio.toFixed(2),
        background: labels.background,
        foreground: labels.foreground,
        minimum: String(THEME_TEXT_CONTRAST_MIN_RATIO),
      });
      return [
        [issue.background, message],
        [issue.foreground, message],
      ];
    })
  ) as ThemeSettingsFieldErrors;
};

export const updateTenantThemeSettingsAction = async (
  _prevState: ThemeSettingsActionState,
  formData: FormData
): Promise<ThemeSettingsActionState> => {
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

  const schema = await tenantThemeSchema(locale);
  const parsed = schema.safeParse(parseTenantThemeFormData(formData));

  if (!parsed.success) {
    return {
      fieldErrors: mapThemeFieldErrors(parsed.error.flatten().fieldErrors),
      message: t("errors.validation"),
      ok: false,
    };
  }

  const contrastIssues = findThemeTextContrastIssues(parsed.data);
  if (contrastIssues.length > 0) {
    return {
      fieldErrors: await mapThemeContrastFieldErrors(contrastIssues, locale),
      message: t("admin.settings.theme.validation.contrast_summary"),
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
    message: t("admin.settings.theme.saved"),
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
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    tenantIconSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      icon: { kind: "file", name: "icon" },
      intent: { kind: "value", name: "intent" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    // One control, so the field message is the form message.
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
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
    message: isDelete
      ? t("admin.settings.icon.deleted")
      : t("admin.settings.icon.saved"),
    ok: true,
  };
};

export const updateTenantLogoAction = async (
  _prevState: TenantLogoActionState,
  formData: FormData
): Promise<TenantLogoActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    tenantLogoSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      intent: { kind: "value", name: "intent" },
      logo: { kind: "file", name: "logo" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    // One control, so the field message is the form message.
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
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
    message: isDelete
      ? t("admin.settings.logo.deleted")
      : t("admin.settings.logo.saved"),
    ok: true,
  };
};
