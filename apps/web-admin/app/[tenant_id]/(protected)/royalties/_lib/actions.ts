"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { requiredTrimmedString } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import { closeRoyaltyStatement } from "#lib/royalties";
import { royaltyPeriodSchema } from "#lib/royalty-period";

import type { CloseRoyaltyStatementActionState } from "../royalty-types";

/**
 * Closes the month the form names, then opens its statement. The fields are
 * hidden, so a failure to parse them is not something the operator can correct
 * and is worded as a failed close.
 */
export const closeRoyaltyStatementAction = async (
  _prevState: CloseRoyaltyStatementActionState,
  formData: FormData
): Promise<CloseRoyaltyStatementActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);
  const parsed = z
    .object({
      period: royaltyPeriodSchema,
      tenantId: requiredTrimmedString(t("admin.royalties.close_failed")),
    })
    .safeParse(
      toFormDataInput(formData, {
        period: "value",
        tenantId: { kind: "value", name: "tenant_id" },
      })
    );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    closeRoyaltyStatement(parsed.data, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  redirect(`/royalties/statements/${parsed.data.period}?closed=1`);
};
