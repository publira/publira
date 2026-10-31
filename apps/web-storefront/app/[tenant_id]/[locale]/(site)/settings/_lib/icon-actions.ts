"use server";

import type { Locale } from "@publira/i18n";
import { sharedRpcErrorMessage } from "@publira/i18n/catalog";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { checkAccountIconFile } from "#lib/account-icon";
import type { AccountIconFileProblem } from "#lib/account-icon";
import {
  accountCacheTag,
  deleteMyIcon,
  selectMyIcon,
  uploadMyIcon,
} from "#lib/auth";
import type { IconChangeOutcome } from "#lib/auth";
import { tenantIdFormSchema } from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import type { StorefrontMessageKey } from "#lib/messages";

/** What the settings screen shows: the outcome in the reader's language. */
export interface IconActionResult {
  message: string;
  ok: boolean;
}

const FILE_PROBLEM_MESSAGES: Record<
  AccountIconFileProblem,
  StorefrontMessageKey
> = {
  "too-large": "storefront.settings.icon_too_large",
  "too-small": "storefront.settings.icon_too_small",
  unsupported: "storefront.settings.icon_unsupported",
};

const iconFormSchema = async (locale: Locale) =>
  z.object({
    locale: localeFormSchema,
    tenantId: await tenantIdFormSchema(locale),
  });

/**
 * The outcome of a change the API was asked for. A change it made refreshes
 * the private account read, so the site header redraws the icon along with
 * the screen the Action was called from.
 */
const settle = async (
  outcome: IconChangeOutcome,
  { locale, tenantId }: { locale: Locale; tenantId: string },
  messages: { done: StorefrontMessageKey; failed: StorefrontMessageKey }
): Promise<IconActionResult> => {
  const t = await getMessagesFor(locale);

  if (outcome.ok) {
    updateTag(accountCacheTag(tenantId));

    return { message: t(messages.done), ok: true };
  }

  switch (outcome.refusal) {
    case "image": {
      return { message: t("storefront.settings.icon_refused"), ok: false };
    }

    case "not-allowed": {
      return { message: t("storefront.settings.icon_not_allowed"), ok: false };
    }

    case "storage-not-configured": {
      return {
        message: t("storefront.settings.icon_storage_unavailable"),
        ok: false,
      };
    }

    default: {
      return {
        message:
          sharedRpcErrorMessage(outcome.refusal, locale) ?? t(messages.failed),
        ok: false,
      };
    }
  }
};

/** Sets the signed-in reader's icon from the `icon` file of the form. */
export const uploadIconAction = async (
  formData: FormData
): Promise<IconActionResult> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so a rejected submission
  // is still worded in the reader's language.
  const submittedLocale = requireFormLocale(formData.get("locale"));

  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    iconFormSchema(submittedLocale),
  ]);

  const parsed = schema.extend({ icon: z.instanceof(File) }).safeParse(
    toFormDataInput(formData, {
      icon: "file",
      locale: "value",
      tenantId: "value",
    })
  );

  if (!parsed.success) {
    return { message: t("storefront.settings.icon_unsupported"), ok: false };
  }

  const { icon, locale, tenantId } = parsed.data;

  // The screen has already checked the file, so this answers a submission that
  // did not come from it, before the bytes are sent on to the API.
  const problem = checkAccountIconFile(icon);

  if (problem) {
    return { message: t(FILE_PROBLEM_MESSAGES[problem]), ok: false };
  }

  const outcome = await uploadMyIcon(tenantId, {
    contentType: icon.type,
    data: new Uint8Array(await icon.arrayBuffer()),
  });

  return settle(
    outcome,
    { locale, tenantId },
    {
      done: "storefront.settings.icon_uploaded",
      failed: "storefront.settings.icon_upload_failed",
    }
  );
};

/** Shows the tenant preset the form's `presetId` names as the reader's icon. */
export const selectIconAction = async (
  formData: FormData
): Promise<IconActionResult> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));

  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    iconFormSchema(submittedLocale),
  ]);

  const parsed = schema
    .extend({ presetId: z.string().trim().min(1) })
    .safeParse(
      toFormDataInput(formData, {
        locale: "value",
        presetId: "value",
        tenantId: "value",
      })
    );

  if (!parsed.success) {
    return { message: t("storefront.settings.icon_select_failed"), ok: false };
  }

  const { locale, presetId, tenantId } = parsed.data;

  const outcome = await selectMyIcon(tenantId, presetId);

  // The preset was deleted after the screen listed it.
  if (!outcome.ok && outcome.refusal === "not-found") {
    return {
      message: t("storefront.settings.icon_preset_unavailable"),
      ok: false,
    };
  }

  return settle(
    outcome,
    { locale, tenantId },
    {
      done: "storefront.settings.icon_selected",
      failed: "storefront.settings.icon_select_failed",
    }
  );
};

/** Leaves the signed-in reader's account with no icon. */
export const removeIconAction = async (
  formData: FormData
): Promise<IconActionResult> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));

  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    iconFormSchema(submittedLocale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, { locale: "value", tenantId: "value" })
  );

  if (!parsed.success) {
    return { message: t("storefront.settings.icon_remove_failed"), ok: false };
  }

  const { locale, tenantId } = parsed.data;

  return settle(
    await deleteMyIcon(tenantId),
    { locale, tenantId },
    {
      done: "storefront.settings.icon_removed",
      failed: "storefront.settings.icon_remove_failed",
    }
  );
};
