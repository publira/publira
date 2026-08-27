"use server";

import { getMessage } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import {
  encryptSessionPayload,
  resolveAuthSecret,
  sessionCookieOptions,
} from "@publira/web-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ADMIN_SESSION_COOKIE_NAME, loginAdmin } from "#lib/admin-auth";
import {
  emailFormSchema,
  nextPathFormSchema,
  passwordFormSchema,
  tenantIdFormSchema,
} from "#lib/auth-input";
import { assertSameOrigin } from "#lib/csrf";
import { getLocale, loadAdminMessages } from "#lib/locale";
import type { AdminMessages } from "#lib/locale";

const loginFormSchema = (messages: AdminMessages) =>
  z.object({
    email: emailFormSchema(messages),
    next: nextPathFormSchema,
    password: passwordFormSchema(messages),
    tenantId: tenantIdFormSchema(messages),
  });

const buildLoginErrorPath = (message: string, nextPath: string): string => {
  const params = new URLSearchParams({
    error: message,
    next: nextPath,
  });
  return `/login?${params.toString()}`;
};

export const loginAction = async (formData: FormData): Promise<void> => {
  await assertSameOrigin();
  const locale = await getLocale();
  const messages = await loadAdminMessages(locale);
  const input = toFormDataInput(formData, {
    email: "value",
    next: "value",
    password: "value",
    tenantId: { kind: "value", name: "tenant_id" },
  });
  const parsed = loginFormSchema(messages).safeParse(input);
  if (!parsed.success) {
    const nextPath = nextPathFormSchema.parse(input.next);
    const tenantIdResult = tenantIdFormSchema(messages).safeParse(
      input.tenantId
    );
    redirect(
      buildLoginErrorPath(
        tenantIdResult.success
          ? toFormErrorMessage(parsed.error)
          : getMessage(messages, "admin.auth.errors.tenant_missing"),
        nextPath
      )
    );
  }

  const { email, next: nextPath, password, tenantId } = parsed.data;

  const result = await loginAdmin(email, password, tenantId, locale);
  if (!result.ok) {
    redirect(buildLoginErrorPath(result.message, nextPath));
  }

  try {
    const sealed = await encryptSessionPayload(
      {
        accessToken: result.accessToken,
        expiresAt: result.expiresAt.toISOString(),
        tenantId,
      },
      resolveAuthSecret()
    );
    const cookieStore = await cookies();
    cookieStore.set({
      ...sessionCookieOptions(result.expiresAt),
      name: ADMIN_SESSION_COOKIE_NAME,
      value: sealed,
    });
  } catch (error) {
    // Not an RPC failure — sealing or writing the cookie broke, and the reason
    // is only visible in the log. Recorded, then reported as a login failure.
    console.error("[web-admin] login cookie seal failed", error);
    redirect(
      buildLoginErrorPath(
        getMessage(messages, "admin.auth.errors.login_processing_failed"),
        nextPath
      )
    );
  }

  redirect(nextPath);
};
