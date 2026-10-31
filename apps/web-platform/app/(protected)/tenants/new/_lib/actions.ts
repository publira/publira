"use server";

import type { Locale } from "@publira/i18n";
import { getLocales } from "@publira/i18n";
import type * as ActionForm from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { platformAuditLogsCacheTag } from "#lib/audit-logs";
import { withPlatformSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { platformDashboardCacheTag } from "#lib/dashboard";
import {
  commaOrNewlineStringListFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { createPlatformTenant, platformTenantsCacheTag } from "#lib/tenants";
import { platformEndUsersCacheTag } from "#lib/users";

/**
 * The new tenant's locales are checked against the supported list here as well
 * as on the server: `Accept-Language` only seeded the selector, and a
 * hand-built request can name any code at all. The form keeps the default's
 * box ticked and sends it as an entry of its own, so a set that leaves it out
 * was not sent by the form.
 */
const createTenantFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      adminDomain: optionalTrimmedString(),
      defaultLocale: z.enum(getLocales(), {
        error: t("platform.tenants.locale_required"),
      }),
      domain: requiredTrimmedString(t("platform.tenants.domain_required")),
      imageDomain: optionalTrimmedString(),
      initialAdminEmails: commaOrNewlineStringListFormSchema,
      name: requiredTrimmedString(t("platform.tenants.name_required")),
      supportedLocales: z.array(
        z.enum(getLocales(), {
          error: t("platform.tenants.supported_locales_invalid"),
        })
      ),
    })
    .refine((value) => value.supportedLocales.includes(value.defaultLocale), {
      error: t("platform.tenants.default_locale_not_offered"),
      path: ["supportedLocales"],
    });
};

export const createTenantAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const schema = await createTenantFormSchema(locale);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      adminDomain: { kind: "value", name: "tenant_admin_domain" },
      defaultLocale: { kind: "value", name: "tenant_default_locale" },
      domain: { kind: "value", name: "tenant_domain" },
      imageDomain: { kind: "value", name: "tenant_image_domain" },
      initialAdminEmails: { kind: "value", name: "initial_admin_emails" },
      name: { kind: "value", name: "tenant_name" },
      supportedLocales: { kind: "values", name: "tenant_supported_locales" },
    })
  );

  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withPlatformSessionReauth(() =>
    createPlatformTenant({ ...parsed.data, locale })
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  // The initial admins take a tenant role, which moves them off the end-user list.
  updateTag(platformTenantsCacheTag);
  updateTag(platformEndUsersCacheTag);
  updateTag(platformDashboardCacheTag);
  updateTag(platformAuditLogsCacheTag);

  if (result.publicId?.trim()) {
    redirect(`/tenants/${result.publicId}`);
  }

  redirect("/tenants");
};
