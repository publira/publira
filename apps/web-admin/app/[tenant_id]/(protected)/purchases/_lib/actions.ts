"use server";

import type { Locale } from "@publira/i18n";
import { formatPrice } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  boundedIntFormSchema,
  requiredRecordId,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { MAX_INT32 } from "#lib/int32";
import { getMessagesFor } from "#lib/messages";
import { parsePriceInput, readCurrency } from "#lib/price";
import {
  purchasesCacheTag,
  refundPurchase,
  refundPurchaseInPart,
} from "#lib/purchase";

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

interface RefundAmount {
  amount: number;
  currency: string;
  left: number;
}

/**
 * The amount staff entered, read in the purchase's currency into its minor
 * unit, and what was left to refund when the drawer was rendered, which is
 * what the amount is held to and what tells a refund in part from one of all
 * that is left. The API holds the amount to what is left as it stands when
 * the refund is made.
 */
const refundAmountSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const target = t("admin.purchases.validation.refund_target");
  const invalid = t("admin.purchases.validation.amount_invalid");

  return z
    .object({
      amount: requiredTrimmedString(invalid, 32),
      currency: z
        .string({ error: target })
        .refine((value) => readCurrency(value) !== null, target),
      left: boundedIntFormSchema(target, { max: MAX_INT32, min: 1 }),
    })
    .transform((value, context): RefundAmount => {
      const amount = parsePriceInput(value.amount, value.currency);

      if (amount === null || amount <= 0 || amount > value.left) {
        context.addIssue({ code: "custom", message: invalid });

        return z.NEVER;
      }

      return { amount, currency: value.currency, left: value.left };
    });
};

/**
 * Refunds one purchase with the reason staff gave, which the API records on
 * the audit log entry: all that is left of it, or, when the form carries an
 * amount below that, a refund in part, which leaves what the reader bought
 * open to them. A form without an amount is a refund of all that is left. The
 * drawer the form sits in is re-rendered from the cleared reads, so the
 * purchase it shows is the refunded one.
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

  let amount: RefundAmount | null = null;

  if (formData.has("amount")) {
    const amountSchema = await refundAmountSchema(locale);

    const parsedAmount = amountSchema.safeParse(
      toFormDataInput(formData, {
        amount: "value",
        currency: "value",
        left: "value",
      })
    );

    if (!parsedAmount.success) {
      return {
        message: toFormErrorMessage(parsedAmount.error, { locale }),
        ok: false,
      };
    }

    amount = parsedAmount.data;
  }

  const result = await withAdminSessionReauth(() =>
    amount && amount.amount < amount.left
      ? refundPurchaseInPart({ ...parsed.data, amount: amount.amount }, locale)
      : refundPurchase(parsed.data, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(purchasesCacheTag(parsed.data.tenantId));
  const t = await getMessagesFor(locale);

  if (amount) {
    return {
      message: t("admin.purchases.refund_requested_toast", {
        amount: formatPrice(amount.amount, {
          currency: amount.currency,
          locale,
        }),
      }),
      ok: true,
    };
  }

  return { message: t("admin.purchases.refunded"), ok: true };
};
