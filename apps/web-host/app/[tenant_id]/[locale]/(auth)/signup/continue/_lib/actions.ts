"use server";

import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { loginWithIdToken } from "#lib/auth";
import { birthDateFormSchema, tenantIdFormSchema } from "#lib/auth-input";
import { writePublicSessionCookie } from "#lib/auth-session";
import { tenantSiteTag } from "#lib/cache-tags";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import { clearPendingSignUp, readPendingSignUp } from "#lib/social-sign-in";
import { signInFailurePath } from "#lib/social-sign-in-paths";
import { readConsentPageVersionIds } from "#lib/tenant";
import { tenantLocalePath } from "#lib/tenant-locale-path";

import { sameVersions } from "../../_lib/consent";

const continueSignUpFormSchema = async (locale: Locale) => {
  const [t, birthDate, tenantId] = await Promise.all([
    getMessagesFor(locale),
    birthDateFormSchema(locale),
    tenantIdFormSchema(locale),
  ]);

  return z
    .object({
      agreedPageVersionIds: z.array(z.string().trim().min(1)).max(2),
      birthDate,
      consent: z.string().optional(),
      locale: localeFormSchema,
      tenantId,
    })
    .refine((value) => value.consent !== undefined, {
      error: t("host.auth.errors.consent_required"),
      path: ["consent"],
    });
};

/**
 * Finish a first sign-in the API held back for consent, sending the token it
 * refused again with the versions the reader agreed to.
 */
export const continueSignUpAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    continueSignUpFormSchema(submittedLocale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      agreedPageVersionIds: "values",
      birthDate: "value",
      consent: "value",
      locale: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale: submittedLocale }),
      ok: false,
    };
  }

  const { agreedPageVersionIds, birthDate, locale, tenantId } = parsed.data;
  const pending = await readPendingSignUp();
  if (!pending || pending.tenantId !== tenantId) {
    redirect(
      await signInFailurePath(
        { intent: "login", locale, returnTo: "/", tenantId },
        t("host.auth.social.errors.expired")
      )
    );
  }

  const publishedVersionIds = await readConsentPageVersionIds(tenantId, locale);
  if (!sameVersions(agreedPageVersionIds, publishedVersionIds)) {
    // The form's cached pages are the stale ones, so dropping them is what
    // re-renders it with the current pages to agree to.
    updateTag(tenantSiteTag(tenantId));
    return { message: t("host.auth.errors.consent_changed"), ok: false };
  }

  const outcome = await loginWithIdToken(tenantId, pending, {
    agreedPageVersionIds: publishedVersionIds,
    birthDate,
    name: pending.name,
  });
  if (outcome.kind === "consent_required") {
    updateTag(tenantSiteTag(tenantId));
    return { message: t("host.auth.errors.consent_changed"), ok: false };
  }
  if (outcome.kind === "refused") {
    rethrowUnclassifiedRpcError(outcome.error);
    // A birth date the API refused is the reader's to correct; anything else
    // ends the sign-in, which has to start over with a fresh token.
    if (rpcErrorDisposition(outcome.error) === "invalid-argument") {
      return {
        message: rpcErrorMessage(
          outcome.error,
          t("host.auth.errors.signup_failed"),
          { locale }
        ),
        ok: false,
      };
    }
    await clearPendingSignUp();
    redirect(
      await signInFailurePath(
        { intent: "login", locale, returnTo: pending.returnTo, tenantId },
        rpcErrorMessage(outcome.error, t("host.auth.social.errors.failed"), {
          locale,
          overrides: { precondition: t("host.auth.social.errors.refused") },
        })
      )
    );
  }

  await clearPendingSignUp();
  await writePublicSessionCookie(outcome.session, tenantId);
  redirect(await tenantLocalePath(tenantId, locale, pending.returnTo));
};
