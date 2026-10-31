"use server";

import type { Locale } from "@publira/i18n";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  beginPasskeyLoginPublic,
  finishPasskeyLoginPublic,
  loginPublic,
} from "#lib/auth";
import type { PasskeyLoginRefusal } from "#lib/auth";
import {
  emailFormSchema,
  passkeyCredentialFormSchema,
  passwordFormSchema,
  returnToFormSchema,
  tenantIdFormSchema,
  tenantIdSchema,
} from "#lib/auth-input";
import { writePublicSessionCookie } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import type { StorefrontMessageAccessor } from "#lib/messages";
import { tenantLocalePath } from "#lib/tenant-locale-path";

import type {
  PasskeyLoginStartState,
  PasskeyLoginState,
} from "./passkey-login-state";

const loginFormSchema = async (locale: Locale) => {
  const [email, password, tenantId] = await Promise.all([
    emailFormSchema(locale),
    passwordFormSchema(locale),
    tenantIdFormSchema(locale),
  ]);

  return z.object({
    email,
    locale: localeFormSchema,
    password,
    returnTo: returnToFormSchema,
    tenantId,
  });
};

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

  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    loginFormSchema(submittedLocale),
  ]);

  const loginFailed = t("storefront.auth.errors.login_failed");

  const parsed = schema.safeParse(
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

  if (!result.ok) {
    // A refusal for too many attempts came before the password was checked,
    // so it says nothing about whether the password was right.
    const message =
      result.refusal === "rate-limited"
        ? t("errors.rpc.rate-limited")
        : loginFailed;

    const errorPath = await buildLoginErrorPath(
      locale,
      tenantId,
      message,
      returnToPath
    );

    redirect(errorPath);
  }

  await writePublicSessionCookie(result.session, tenantId);

  // `returnTo` is stored locale-less, so the reader comes back in whichever
  // language they signed in from rather than the one they left.
  const destination = await tenantLocalePath(tenantId, locale, returnToPath);
  redirect(destination);
};

const passkeyRefusalMessage = (
  t: StorefrontMessageAccessor,
  refusal: PasskeyLoginRefusal
): string =>
  refusal === "rate-limited"
    ? t("errors.rpc.rate-limited")
    : t("storefront.auth.errors.passkey_failed");

/**
 * The first half of a sign-in with a passkey. The browser asks the
 * authenticator with what this answers and hands the assertion to
 * {@link finishPasskeyLoginAction}.
 */
export const beginPasskeyLoginAction = async (
  formData: FormData
): Promise<PasskeyLoginStartState> => {
  await assertSameOrigin();
  const t = await getMessagesFor(requireFormLocale(formData.get("locale")));

  const tenantId = tenantIdSchema.safeParse(
    toFormDataInput(formData, { tenantId: "value" }).tenantId
  );

  if (!tenantId.success) {
    return { message: t("storefront.auth.errors.passkey_failed"), ok: false };
  }

  const result = await beginPasskeyLoginPublic(tenantId.data);

  if (!result.ok) {
    return { message: passkeyRefusalMessage(t, result.refusal), ok: false };
  }

  return { message: "", ok: true, optionsJson: result.optionsJson };
};

const passkeyLoginFormSchema = z.object({
  credential: passkeyCredentialFormSchema,
  locale: localeFormSchema,
  returnTo: returnToFormSchema,
  tenantId: tenantIdSchema,
});

/**
 * Exchange the assertion the browser made for a session, written as
 * {@link loginAction} writes one, and go on to where the reader was heading. A
 * submission without an assertion did not come from the passkey control, so it
 * is reported the way an assertion the API refused is.
 */
export const finishPasskeyLoginAction = async (
  formData: FormData
): Promise<PasskeyLoginState> => {
  await assertSameOrigin();
  const t = await getMessagesFor(requireFormLocale(formData.get("locale")));

  const parsed = passkeyLoginFormSchema.safeParse(
    toFormDataInput(formData, {
      credential: "value",
      locale: "value",
      returnTo: "value",
      tenantId: "value",
    })
  );

  if (!parsed.success) {
    return { message: t("storefront.auth.errors.passkey_failed"), ok: false };
  }

  const { credential, locale, returnTo: returnToPath, tenantId } = parsed.data;
  const result = await finishPasskeyLoginPublic(tenantId, credential);

  if (!result.ok) {
    return { message: passkeyRefusalMessage(t, result.refusal), ok: false };
  }

  await writePublicSessionCookie(result.session, tenantId);

  const destination = await tenantLocalePath(tenantId, locale, returnToPath);
  redirect(destination);
};
