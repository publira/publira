"use server";

import type { Locale } from "@publira/i18n";
import type * as ActionForm from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { requiredRecordId, requiredTrimmedString } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import {
  deleteReaderIconPreset,
  tenantReaderIconPolicyCacheTag,
  tenantReaderIconPresetsCacheTag,
  updateTenantReaderIconPolicy,
  uploadReaderIconPreset,
} from "#lib/reader-icon-settings";
import { TENANT_READER_ICON_POLICIES } from "#lib/reader-icon-settings-shared";

/**
 * The most a preset upload may weigh, which is what the API holds a reader's
 * own icon upload to. `next.config.ts` admits a Server Action body one MiB
 * larger, for the multipart framing around it.
 */
const PRESET_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

const PRESET_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const tenantIdSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return requiredTrimmedString(t("admin.settings.tenant_missing"));
};

const policySchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    policy: z.enum(TENANT_READER_ICON_POLICIES, {
      error: t("admin.settings.reader_icons.policy.validation.required"),
    }),
    tenantId: await tenantIdSchema(locale),
  });
};

const uploadSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    icon: z
      .custom<File>((value) => value instanceof File, {
        error: t("admin.settings.image.file_required"),
      })
      .refine((file) => file.size <= PRESET_IMAGE_MAX_BYTES, {
        error: t("admin.settings.image.too_large"),
      })
      .refine((file) => PRESET_IMAGE_CONTENT_TYPES.has(file.type), {
        error: t("admin.settings.image.unsupported_type"),
      }),
    tenantId: await tenantIdSchema(locale),
  });
};

const deleteSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    presetId: requiredRecordId(
      t("admin.settings.reader_icons.presets.validation.id_missing")
    ),
    tenantId: await tenantIdSchema(locale),
  });
};

export const updateReaderIconPolicyAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    policySchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      policy: { kind: "value", name: "reader_icon_policy" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { policy, tenantId } = parsed.data;

  const result = await withAdminSessionReauth(() =>
    updateTenantReaderIconPolicy({ policy, tenantId }, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  // The tab reads the policy through a private cache, so without this the
  // operator would keep seeing the previous choice in the same session. The
  // storefront's copies are dropped by the API as the save lands.
  updateTag(tenantReaderIconPolicyCacheTag(tenantId));

  return {
    message: t("admin.settings.reader_icons.policy.saved"),
    ok: true,
  };
};

export const uploadReaderIconPresetAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    uploadSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      icon: { kind: "file", name: "icon" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );

  if (!parsed.success) {
    // One control, so the field message is the form message.
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { icon, tenantId } = parsed.data;

  // The file is read into memory inside the callback, so an unauthorized caller
  // never gets a 10MB upload buffered on its behalf.
  const result = await withAdminSessionReauth(async () =>
    uploadReaderIconPreset(
      {
        iconContentType: icon.type,
        iconData: new Uint8Array(await icon.arrayBuffer()),
        tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(tenantReaderIconPresetsCacheTag(tenantId));

  return {
    message: t("admin.settings.reader_icons.presets.uploaded"),
    ok: true,
  };
};

export const deleteReaderIconPresetAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    deleteSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      presetId: { kind: "value", name: "preset_id" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { presetId, tenantId } = parsed.data;

  const result = await withAdminSessionReauth(() =>
    deleteReaderIconPreset({ presetId, tenantId }, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(tenantReaderIconPresetsCacheTag(tenantId));

  return {
    message: t("admin.settings.reader_icons.presets.deleted"),
    ok: true,
  };
};
