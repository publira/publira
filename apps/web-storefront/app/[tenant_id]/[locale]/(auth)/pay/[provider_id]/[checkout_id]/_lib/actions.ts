"use server";

import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import type * as ActionForm from "@publira/ui-components/action-form";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { apiClient } from "#lib/api-client";
import { tenantIdSchema } from "#lib/auth-input";
import { tenantPurchasesTag, tenantReaderAccessTag } from "#lib/cache-tags";
import { assertSameOrigin } from "#lib/csrf";
import {
  LOCALE_FIELD_NAME,
  localeFormSchema,
  requireFormLocale,
} from "#lib/locale-form";
import { getMessagesFor } from "#lib/messages";

const idSchema = z.string().trim().min(1).max(255);

const completeFormSchema = z.object({
  checkoutId: idSchema,
  locale: localeFormSchema,
  paymentId: idSchema,
  provider: idSchema,
  tenantId: tenantIdSchema,
});

/**
 * Hands the server the payment the provider's script authorized, which
 * captures it and records the purchase. A refusal answers the message the
 * page shows beside its button.
 *
 * The page is reached without the reader's session, so the call carries none:
 * the server knows whose checkout it is from the checkout itself.
 */
export const completeBrowserCheckoutAction = async (
  formData: FormData
): Promise<ActionForm.Result> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get(LOCALE_FIELD_NAME));
  const t = await getMessagesFor(submittedLocale);

  const parsed = completeFormSchema.safeParse(
    toFormDataInput(formData, {
      checkoutId: "value",
      locale: "value",
      paymentId: "value",
      provider: "value",
      tenantId: "value",
    })
  );

  if (!parsed.success) {
    return { message: t("storefront.pay.errors.complete_failed"), ok: false };
  }

  const { checkoutId, locale, paymentId, provider, tenantId } = parsed.data;

  try {
    await apiClient.purchase.completeBrowserCheckout({
      checkoutId,
      paymentId,
      provider,
      tenant: { tenantId },
    });
  } catch (error) {
    rethrowUnclassifiedRpcError(error);

    // A payment that is not the checkout's, or a second one of a checkout
    // already paid, is refused before anything captures it.
    return {
      message: rpcErrorMessage(
        error,
        t("storefront.pay.errors.complete_failed"),
        {
          locale,
          overrides: {
            "invalid-argument": t("storefront.pay.errors.payment_refused"),
            "not-found": t("storefront.pay.errors.payment_refused"),
          },
        }
      ),
      ok: false,
    };
  }

  updateTag(tenantReaderAccessTag(tenantId));
  updateTag(tenantPurchasesTag(tenantId));

  return { message: "", ok: true };
};
