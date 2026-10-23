"use server";

import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import type * as ActionForm from "@publira/ui-components/action-form";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { returnToFormSchema, tenantIdFormSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  LEGAL_PAGE_AGREEMENT_PATH,
  legalPageAgreementHref,
  legalPageAgreementReturnTo,
} from "#lib/legal-page-agreement-path";
import { agreeToLegalPages } from "#lib/legal-page-agreements";
import { localeFormSchema, requireFormLocale } from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const agreementFormSchema = async (locale: Locale) => {
  const [t, tenantId] = await Promise.all([
    getMessagesFor(locale),
    tenantIdFormSchema(locale),
  ]);

  return z.object({
    agreedPageVersionIds: z.array(z.string().trim().min(1)).min(1).max(2),
    consent: z.string({
      error: t("storefront.auth.errors.agreement_required"),
    }),
    locale: localeFormSchema,
    returnTo: returnToFormSchema,
    tenantId,
  });
};

/**
 * Record the signed-in reader's agreement to the pages the screen showed them,
 * then send them back where they were.
 *
 * A version published since the screen was drawn is reported rather than
 * agreed to: the screen is drawn again with the pages to agree to now, so the
 * reader agrees only to text they were shown.
 */
export const agreeToLegalPagesAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const [t, schema] = await Promise.all([
    getMessagesFor(submittedLocale),
    agreementFormSchema(submittedLocale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      agreedPageVersionIds: "values",
      consent: "value",
      locale: "value",
      returnTo: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale: submittedLocale }),
      ok: false,
    };
  }

  const { agreedPageVersionIds, locale, tenantId } = parsed.data;
  const returnTo = legalPageAgreementReturnTo(parsed.data.returnTo);
  const agreementPath = legalPageAgreementHref(
    LEGAL_PAGE_AGREEMENT_PATH,
    returnTo
  );
  const accessToken = await requirePublicSession(
    locale,
    agreementPath,
    tenantId
  );

  let outcome: Awaited<ReturnType<typeof agreeToLegalPages>>;
  try {
    outcome = await withPublicSessionReauth(
      locale,
      agreementPath,
      () =>
        agreeToLegalPages(tenantId, locale, agreedPageVersionIds, accessToken),
      tenantId
    );
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("storefront.auth.errors.agreement_failed"),
        { locale }
      ),
      ok: false,
    };
  }

  if (outcome === "changed") {
    refresh();
    return { message: t("storefront.auth.errors.consent_changed"), ok: false };
  }

  redirect(await tenantLocalePath(tenantId, locale, returnTo));
};
