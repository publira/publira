"use server";

import type { FormActionState } from "@publira/utils/form-action";
import { redirect } from "next/navigation";

import { createPlatformTenant } from "#lib/tenants";

export const createTenantAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const name = String(formData.get("tenant_name") ?? "").trim();
  const domain = String(formData.get("tenant_domain") ?? "").trim();
  const adminDomain = String(formData.get("tenant_admin_domain") ?? "").trim();
  const initialAdminEmailsRaw = String(
    formData.get("initial_admin_emails") ?? ""
  );
  const initialAdminEmails = initialAdminEmailsRaw
    .split(/[\n,]/)
    .map((email) => email.trim())
    .filter((email) => email.length > 0);

  if (!name || !domain) {
    return { message: "テナント名とドメインは必須です。", ok: false };
  }

  const result = await createPlatformTenant({
    adminDomain,
    domain,
    initialAdminEmails,
    name,
  });

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  if (result.publicId?.trim()) {
    redirect(`/tenants/${result.publicId}`);
  }
  redirect("/tenants");
};
