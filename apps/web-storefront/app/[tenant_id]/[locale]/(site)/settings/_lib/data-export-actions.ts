"use server";

import type { Locale } from "@publira/i18n";
import { sharedRpcErrorMessage } from "@publira/i18n/catalog";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { tenantIdSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { requestMyDataExport } from "#lib/data-export";
import type { DataExportRequestOutcome } from "#lib/data-export";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";

import { buildSettingsPath } from "./settings-form";

const SETTINGS_RETURN_TO = "/settings";

const requestDataExportFormSchema = z.object({
  locale: localeFormSchema,
  tenantId: tenantIdSchema,
});

/**
 * The flash a refused request for the archive is worded with. A refusal the
 * shared RPC copy words — a request past the platform's limit, an outage —
 * keeps that wording.
 */
const dataExportRefusalMessage = async (
  locale: Locale,
  refusal: Extract<DataExportRequestOutcome, { ok: false }>["refusal"]
): Promise<string> => {
  const t = await getMessagesFor(locale);

  switch (refusal) {
    case "in-progress": {
      return t("storefront.settings.data_export_in_progress");
    }

    case "storage-not-configured": {
      return t("storefront.settings.data_export_storage_unavailable");
    }

    default: {
      return (
        sharedRpcErrorMessage(refusal, locale) ??
        t("storefront.settings.data_export_request_failed")
      );
    }
  }
};

/**
 * Ask for an archive of the signed-in reader's data. The settings screen then
 * shows it being prepared, until the worker has built it and the reader can
 * download it from the same section.
 */
export const requestDataExportAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));

  const parsed = requestDataExportFormSchema.safeParse(
    toFormDataInput(formData, { locale: "value", tenantId: "value" })
  );

  if (!parsed.success) {
    const t = await getMessagesFor(submittedLocale);

    const errorPath = await buildSettingsPath(
      submittedLocale,
      String(formData.get("tenantId") ?? ""),
      "error",
      t("storefront.settings.data_export_request_failed")
    );

    redirect(errorPath);
  }

  const { locale, tenantId } = parsed.data;

  const accessToken = await requirePublicSession(
    locale,
    SETTINGS_RETURN_TO,
    tenantId
  );

  const outcome = await withPublicSessionReauth(
    locale,
    SETTINGS_RETURN_TO,
    () => requestMyDataExport(tenantId, accessToken),
    tenantId
  );

  if (!outcome.ok) {
    const errorPath = await buildSettingsPath(
      locale,
      tenantId,
      "error",
      await dataExportRefusalMessage(locale, outcome.refusal)
    );

    redirect(errorPath);
  }

  const t = await getMessagesFor(locale);

  const successPath = await buildSettingsPath(
    locale,
    tenantId,
    "success",
    t("storefront.settings.data_export_requested")
  );

  redirect(successPath);
};
