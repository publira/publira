"use server";

import type { Locale } from "@publira/i18n";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { requiredRecordId, requiredTrimmedString } from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import { purchasesCacheTag, refundPurchase } from "#lib/purchase";

import type { RefundPurchaseActionState } from "../purchase-types";

const refundPurchaseSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    purchaseId: requiredRecordId(t("admin.purchases.validation.refund_target")),
    reason: requiredTrimmedString(
      t("admin.purchases.validation.reason_required"),
      1000,
      t("admin.purchases.validation.reason_too_long")
    ),
    tenantId: requiredTrimmedString(
      t("admin.purchases.validation.refund_target")
    ),
  });
};

/**
 * Refunds one purchase with the reason staff gave, which the API records on
 * the audit log entry. The drawer the form sits in is re-rendered from the
 * cleared reads, so the purchase it shows is the refunded one.
 */
export const refundPurchaseAction = async (
  _prevState: RefundPurchaseActionState,
  formData: FormData
): Promise<RefundPurchaseActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await refundPurchaseSchema(locale);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      purchaseId: { kind: "value", name: "purchase_id" },
      reason: "value",
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );

  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    refundPurchase(parsed.data, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(purchasesCacheTag(parsed.data.tenantId));
  const t = await getMessagesFor(locale);

  return { message: t("admin.purchases.refunded"), ok: true };
};
