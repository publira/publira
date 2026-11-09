"use server";

import type { Locale } from "@publira/i18n";
import type * as ActionForm from "@publira/ui-components/action-form";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { verifyMfaPublic } from "#lib/auth";
import { tenantIdSchema } from "#lib/auth-input";
import { writePublicSessionCookie } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import type { StorefrontMessageAccessor } from "#lib/messages";
import { clearMfaChallenge, readMfaChallenge } from "#lib/mfa-challenge";
import { mfaRefusalMessage } from "#lib/mfa-refusal-message";
import { tenantLocalePath } from "#lib/tenant-locale-path";

import { MFA_METHODS } from "./method";

const verifyFormSchema = z.object({
  // A recovery code is ten characters with a separator, so anything far
  // longer did not come from either source.
  code: z.string().trim().min(1).max(64),
  locale: localeFormSchema,
  method: z.enum(MFA_METHODS).catch("authenticator"),
  tenantId: tenantIdSchema,
});

/**
 * Back to the sign-in screen, saying the sign-in has to start over, with the
 * reader still heading where they were.
 */
const startOver = async (
  t: StorefrontMessageAccessor,
  locale: Locale,
  tenantId: string,
  returnTo: string
): Promise<never> => {
  await clearMfaChallenge();

  const params = new URLSearchParams({
    error: t("storefront.auth.two_step.expired"),
    returnTo,
  });

  redirect(
    `${await tenantLocalePath(tenantId, locale, "/login")}?${params.toString()}`
  );
};

/**
 * Settle the challenge the sign-in left with a code from the authenticator or
 * one of the recovery codes, write the session it buys, and go on to where the
 * reader was heading. A refused code stays on the form; a challenge that is
 * over sends the reader to sign in again.
 */
export const verifyMfaAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const t = await getMessagesFor(submittedLocale);

  const parsed = verifyFormSchema.safeParse(
    toFormDataInput(formData, {
      code: "value",
      locale: "value",
      method: "value",
      tenantId: "value",
    })
  );

  if (!parsed.success) {
    return { message: t("storefront.auth.two_step.code_required"), ok: false };
  }

  const { code, locale, method, tenantId } = parsed.data;
  const challenge = await readMfaChallenge();

  if (!challenge || challenge.tenantId !== tenantId) {
    return startOver(t, locale, tenantId, challenge?.returnTo ?? "/");
  }

  const outcome = await verifyMfaPublic(
    tenantId,
    challenge.challengeToken,
    code
  );

  if (outcome.kind === "refused") {
    return {
      message: mfaRefusalMessage(t, outcome.refusal, method),
      ok: false,
    };
  }

  if (outcome.kind === "expired") {
    return startOver(t, locale, tenantId, challenge.returnTo);
  }

  await clearMfaChallenge();
  await writePublicSessionCookie(outcome.session, tenantId);

  redirect(await tenantLocalePath(tenantId, locale, challenge.returnTo));
};
