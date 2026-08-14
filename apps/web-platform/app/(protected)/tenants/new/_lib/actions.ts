"use server";

import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  commaOrNewlineStringListFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { createPlatformTenant } from "#lib/tenants";

const createTenantFormSchema = z.object({
  adminDomain: optionalTrimmedString(),
  domain: requiredTrimmedString("テナント名とドメインは必須です。"),
  initialAdminEmails: commaOrNewlineStringListFormSchema,
  name: requiredTrimmedString("テナント名とドメインは必須です。"),
});

export const createTenantAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const parsed = createTenantFormSchema.safeParse(
    toFormDataInput(formData, {
      adminDomain: { kind: "value", name: "tenant_admin_domain" },
      domain: { kind: "value", name: "tenant_domain" },
      initialAdminEmails: { kind: "value", name: "initial_admin_emails" },
      name: { kind: "value", name: "tenant_name" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const result = await createPlatformTenant(parsed.data);

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  if (result.publicId?.trim()) {
    redirect(`/tenants/${result.publicId}`);
  }
  redirect("/tenants");
};
