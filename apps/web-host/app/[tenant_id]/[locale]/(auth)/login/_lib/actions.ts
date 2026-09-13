"use server";

import type { Locale } from "@publira/i18n";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { loginPublic } from "#lib/auth";
import {
  emailFormSchema,
  passwordFormSchema,
  returnToFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";
import { writePublicSessionCookie } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import type { HostMessageAccessor } from "#lib/messages";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const loginFormSchema = (t: HostMessageAccessor) =>
  z.object({
    email: emailFormSchema(t),
    locale: localeFormSchema,
    password: passwordFormSchema(t),
    returnTo: returnToFormSchema,
    tenantId: tenantIdFormSchema(t),
  });

const buildLoginErrorPath = async (
  locale: Locale,
  tenantId: string,
  message: string,
  returnToPath: string
): Promise<string> => {
  const params = new URLSearchParams({
    error: message,
    returnTo: returnToPath,
  });
  const path = await tenantLocalePath(tenantId, locale, "/login");
  return `${path}?${params.toString()}`;
};

export const loginAction = async (formData: FormData): Promise<void> => {
  await assertSameOrigin();
  // The locale field falls back rather than failing, so the rejection below can
  // be worded in the reader's language even when the rest of the form is not.
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);
  const loginFailed = t("host.auth.errors.login_failed");
  const parsed = loginFormSchema(t).safeParse(
    toFormDataInput(formData, {
      email: "value",
      locale: "value",
      password: "value",
      returnTo: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    const returnToPath = returnToFormSchema.parse(
      toFormDataInput(formData, { returnTo: "value" }).returnTo
    );
    const errorPath = await buildLoginErrorPath(
      submittedLocale,
      String(formData.get("tenantId") ?? ""),
      loginFailed,
      returnToPath
    );
    redirect(errorPath);
  }

  const {
    email,
    locale,
    password,
    returnTo: returnToPath,
    tenantId,
  } = parsed.data;

  const result = await loginPublic(email, password, tenantId);
  if (!result) {
    const errorPath = await buildLoginErrorPath(
      locale,
      tenantId,
      loginFailed,
      returnToPath
    );
    redirect(errorPath);
  }

  await writePublicSessionCookie(result, tenantId);

  // `returnTo` is stored locale-less, so the reader comes back in whichever
  // language they signed in from rather than the one they left.
  const destination = await tenantLocalePath(tenantId, locale, returnToPath);
  redirect(destination);
};
