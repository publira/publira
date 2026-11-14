"use server";

import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { apiClient, buildSessionHeaders } from "#lib/api-client";
import { tenantIdSchema } from "#lib/auth-input";
import { redirectToLogin, requirePublicSession } from "#lib/auth-session";
import { isUnauthenticatedError } from "#lib/auth-shared";
import { tenantPurchasesTag, tenantReaderAccessTag } from "#lib/cache-tags";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema } from "#lib/locale-form";
import { paymentProviderFormSchema } from "#lib/payment-providers";
import { PROMOTION_CODE_MAX_SALES } from "#lib/promotion-code";
import type { PromotionCodeState } from "#lib/promotion-code";
import {
  promotionCodeFormSchema,
  refusedForPromotionCode,
} from "#lib/promotion-code-form";
import { quoteVolumePromotionCode } from "#lib/promotion-code-quote";
import { recordIdSchema } from "#lib/record-id";
import { getTenantSiteInfo } from "#lib/tenant";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const seriesFormSchema = z.object({
  locale: localeFormSchema,
  seriesPublicId: z.string().trim().min(1).max(64),
  tenantId: tenantIdSchema,
});

const volumeCheckoutFormSchema = seriesFormSchema.extend({
  promotionCode: promotionCodeFormSchema,
  provider: paymentProviderFormSchema,
  volumeId: recordIdSchema,
});

/**
 * The volumes section's code field: the code the reader typed and the volumes
 * on sale there, which are the ones the code is quoted against.
 */
const volumePromotionCodeFormSchema = seriesFormSchema.extend({
  promotionCode: promotionCodeFormSchema,
  volumeIds: z.array(recordIdSchema).min(1).max(PROMOTION_CODE_MAX_SALES),
});

const remainderCheckoutFormSchema = seriesFormSchema.extend({
  provider: paymentProviderFormSchema,
  seriesId: recordIdSchema,
});

type SeriesForm = z.output<typeof seriesFormSchema>;

const seriesPath = (seriesPublicId: string): string =>
  `/series/${seriesPublicId}`;

/**
 * Hand the reader to the provider's checkout `start` answers, starting from
 * the series page and coming back to it.
 *
 * Every refusal the page already words leads back to it, which reads what the
 * reader holds again and says what is true now: a volume or a rest of the
 * series already bought, one taken off sale, or one with nothing left to sell.
 * A code that stopped applying between the quote and the press leads back with
 * the code, which quotes it again and says why. Anything else is the page's
 * `checkout=error` notice.
 */
const startCheckout = async (
  {
    locale,
    promotionCode = "",
    seriesPublicId,
    tenantId,
  }: SeriesForm & { promotionCode?: string },
  start: (sessionId: string) => Promise<{ checkoutUrl: string }>
): Promise<never> => {
  // `returnTo` stays locale-less, the shape `sanitizeRedirectPath` stores;
  // only the `redirect()` targets below take a prefix.
  const returnTo = seriesPath(seriesPublicId);
  // Guard crafted form posts as well as the hidden controls. A failed
  // availability read is not permission to attempt Checkout.
  const tenant = await getTenantSiteInfo(tenantId);

  if (!tenant?.acceptsPayments) {
    redirect(await tenantLocalePath(tenantId, locale, returnTo));
  }

  const sessionId = await requirePublicSession(locale, returnTo, tenantId);

  let checkoutURL = "";

  try {
    const response = await start(sessionId);
    checkoutURL = response.checkoutUrl.trim();
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      await redirectToLogin(locale, returnTo, tenantId);
    }

    if (promotionCode && refusedForPromotionCode(error)) {
      redirect(
        await tenantLocalePath(
          tenantId,
          locale,
          `${returnTo}?${new URLSearchParams({ promotion_code: promotionCode }).toString()}`
        )
      );
    }

    if (
      isRpcError(
        error,
        Code.AlreadyExists,
        Code.FailedPrecondition,
        Code.NotFound
      )
    ) {
      redirect(await tenantLocalePath(tenantId, locale, returnTo));
    }

    rethrowUnclassifiedRpcError(error);
  }

  if (!checkoutURL) {
    redirect(
      await tenantLocalePath(tenantId, locale, `${returnTo}?checkout=error`)
    );
  }

  // A code that takes the whole price off records the purchase at once, and
  // the URL answered is the page's own return from a payment.
  if (promotionCode) {
    updateTag(tenantReaderAccessTag(tenantId));
    updateTag(tenantPurchasesTag(tenantId));
  }

  redirect(checkoutURL);
};

/** Buy one volume of the series, which opens every episode it holds. */
export const startVolumeCheckoutAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();

  const parsed = volumeCheckoutFormSchema.safeParse(
    toFormDataInput(formData, {
      locale: "value",
      promotionCode: "value",
      provider: "value",
      seriesPublicId: "value",
      tenantId: "value",
      volumeId: "value",
    })
  );

  if (!parsed.success) {
    redirect("/");
  }

  const { promotionCode, provider, tenantId, volumeId } = parsed.data;
  await startCheckout(parsed.data, (sessionId) =>
    apiClient.purchase.startVolumeCheckout(
      { promotionCode, provider, tenant: { tenantId }, volumeId },
      buildSessionHeaders(sessionId)
    )
  );
};

/**
 * Quote the code the reader typed in the volumes section against the volumes
 * on sale there, for the section to rewrite their buttons with.
 *
 * The answer is the field's state, not a redirect: the quote spends one of the
 * reader's lookups, and a page that read the code back from the URL to show it
 * would spend another. An empty field takes the code off.
 */
export const applyVolumePromotionCodeAction = async (
  _previous: PromotionCodeState<string>,
  formData: FormData
): Promise<PromotionCodeState<string>> => {
  await assertSameOrigin();

  const parsed = volumePromotionCodeFormSchema.safeParse(
    toFormDataInput(formData, {
      locale: "value",
      promotionCode: "value",
      seriesPublicId: "value",
      tenantId: "value",
      volumeIds: "values",
    })
  );

  if (!parsed.success) {
    redirect("/");
  }

  const { locale, promotionCode, seriesPublicId, tenantId, volumeIds } =
    parsed.data;

  const returnTo = seriesPath(seriesPublicId);
  const sessionId = await requirePublicSession(locale, returnTo, tenantId);

  try {
    return await quoteVolumePromotionCode({
      code: promotionCode,
      sessionId,
      tenantId,
      volumeIds: [...new Set(volumeIds)],
    });
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      await redirectToLogin(locale, returnTo, tenantId);
    }

    throw error;
  }
};

/**
 * Buy every episode of the series the reader does not hold yet, at the
 * series' bundle discount, in one checkout.
 */
export const startSeriesRemainderCheckoutAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();

  const parsed = remainderCheckoutFormSchema.safeParse(
    toFormDataInput(formData, {
      locale: "value",
      provider: "value",
      seriesId: "value",
      seriesPublicId: "value",
      tenantId: "value",
    })
  );

  if (!parsed.success) {
    redirect("/");
  }

  const { locale, provider, seriesId, tenantId } = parsed.data;
  await startCheckout(parsed.data, (sessionId) =>
    apiClient.purchase.startSeriesRemainderCheckout(
      { locale, provider, seriesId, tenant: { tenantId } },
      buildSessionHeaders(sessionId)
    )
  );
};
