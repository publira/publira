"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFieldErrors } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { checkboxOnFormSchema, requiredTrimmedString } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import {
  hasSecretKey,
  secretKeyFormInput,
  secretKeySchema,
  toSecretKeyUpdate,
} from "#lib/secret-key-form";
import {
  tenantSignInSettingsCacheTag,
  updateTenantSignInSettings,
} from "#lib/tenant-sign-in-settings";

// The API's patterns (server/internal/signin), which it applies after trimming
// and, for the two Apple IDs, capitalizing.
const SERVICES_ID_RE = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u;
const APPLE_ID_RE = /^[A-Z0-9]{10}$/u;
const GOOGLE_CLIENT_ID_RE = /^[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com$/u;

const trimmed = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : ""),
  z.string()
);

const capitalized = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : ""),
  z.string()
);

/**
 * A provider's fields are posted whether or not it is switched on, so turning
 * one off keeps what it had; switched on, it needs everything the API does.
 */
const signInSettingsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      appleEnabled: checkboxOnFormSchema,
      googleEnabled: checkboxOnFormSchema,
      iosClientId: trimmed,
      keyId: capitalized,
      privateKey: secretKeySchema(
        t("admin.settings.sign_in.validation.key_file_too_large")
      ),
      servicesId: trimmed,
      teamId: capitalized,
      tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
      webClientId: trimmed,
    })
    .superRefine((value, ctx) => {
      if (value.servicesId && !SERVICES_ID_RE.test(value.servicesId)) {
        ctx.addIssue({
          code: "custom",
          message: t("admin.settings.sign_in.validation.services_id_invalid"),
          path: ["servicesId"],
        });
      }
      for (const field of ["teamId", "keyId"] as const) {
        const id = value[field];
        if (id && !APPLE_ID_RE.test(id)) {
          ctx.addIssue({
            code: "custom",
            message:
              field === "teamId"
                ? t("admin.settings.sign_in.validation.team_id_invalid")
                : t("admin.settings.sign_in.validation.key_id_invalid"),
            path: [field],
          });
        }
      }
      if (value.appleEnabled) {
        if (!value.teamId) {
          ctx.addIssue({
            code: "custom",
            message: t("admin.settings.sign_in.validation.team_id_required"),
            path: ["teamId"],
          });
        }
        if (!value.keyId) {
          ctx.addIssue({
            code: "custom",
            message: t("admin.settings.sign_in.validation.key_id_required"),
            path: ["keyId"],
          });
        }
        if (!hasSecretKey(value.privateKey)) {
          ctx.addIssue({
            code: "custom",
            message: t(
              "admin.settings.sign_in.validation.private_key_required"
            ),
            path: ["privateKey"],
          });
        }
      }

      for (const field of ["webClientId", "iosClientId"] as const) {
        const id = value[field];
        if (id && !GOOGLE_CLIENT_ID_RE.test(id)) {
          ctx.addIssue({
            code: "custom",
            message: t("admin.settings.sign_in.validation.client_id_invalid"),
            path: [field],
          });
        }
      }
      if (value.googleEnabled && !value.webClientId && !value.iosClientId) {
        ctx.addIssue({
          code: "custom",
          message: t("admin.settings.sign_in.validation.client_id_required"),
          path: ["webClientId"],
        });
      }
    });
};

export const updateTenantSignInSettingsAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    signInSettingsSchema(locale),
  ]);
  const parsed = schema.safeParse({
    ...toFormDataInput(formData, {
      appleEnabled: { kind: "value", name: "apple_enabled" },
      googleEnabled: { kind: "value", name: "google_enabled" },
      iosClientId: { kind: "value", name: "google_ios_client_id" },
      keyId: { kind: "value", name: "apple_key_id" },
      servicesId: { kind: "value", name: "apple_services_id" },
      teamId: { kind: "value", name: "apple_team_id" },
      tenantId: { kind: "value", name: "tenant_id" },
      webClientId: { kind: "value", name: "google_web_client_id" },
    }),
    privateKey: secretKeyFormInput(formData, "apple_private_key"),
  });
  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error),
      message: t("errors.validation"),
      ok: false,
    };
  }

  const { data } = parsed;
  const privateKey = await toSecretKeyUpdate(data.privateKey);
  const result = await withAdminSessionReauth(() =>
    updateTenantSignInSettings(
      {
        apple: {
          enabled: data.appleEnabled,
          keyId: data.keyId,
          privateKey,
          servicesId: data.servicesId,
          teamId: data.teamId,
        },
        google: {
          enabled: data.googleEnabled,
          iosClientId: data.iosClientId,
          webClientId: data.webClientId,
        },
        tenantId: data.tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      message: result.message,
      ok: false,
    };
  }

  // The public site's tenant read is revalidated by the API as the save lands.
  updateTag(tenantSignInSettingsCacheTag(data.tenantId));

  return { message: t("admin.settings.sign_in.saved"), ok: true };
};
