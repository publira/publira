"use server";

import { getMessage } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { withPlatformSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  commaOrNewlineStringListFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import type { PlatformMessages } from "#lib/locale";
import { readPlatformDefaultLocale } from "#lib/platform-settings";
import { createPlatformTenant } from "#lib/tenants";

const createTenantFormSchema = (messages: PlatformMessages) =>
  z.object({
    adminDomain: optionalTrimmedString(),
    domain: requiredTrimmedString(
      getMessage(messages, "platform.tenants.domain_required")
    ),
    initialAdminEmails: commaOrNewlineStringListFormSchema,
    name: requiredTrimmedString(
      getMessage(messages, "platform.tenants.name_required")
    ),
  });

export const createTenantAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);

  const parsed = createTenantFormSchema(messages).safeParse(
    toFormDataInput(formData, {
      adminDomain: { kind: "value", name: "tenant_admin_domain" },
      domain: { kind: "value", name: "tenant_domain" },
      initialAdminEmails: { kind: "value", name: "initial_admin_emails" },
      name: { kind: "value", name: "tenant_name" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withPlatformSessionReauth(async () => {
    // The API requires the new tenant's locale, so it is stated here rather
    // than left to the server. The creation form gains its own selector in
    // #1246; until then the configured platform default is that decision.
    const platformDefault = await readPlatformDefaultLocale(locale);
    if (!platformDefault.ok) {
      return { message: platformDefault.message, ok: false as const };
    }

    return createPlatformTenant({
      ...parsed.data,
      defaultLocale: platformDefault.defaultLocale,
      locale,
    });
  });

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  if (result.publicId?.trim()) {
    redirect(`/tenants/${result.publicId}`);
  }
  redirect("/tenants");
};
