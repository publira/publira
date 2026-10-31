"use server";

import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { apiClient, buildSessionHeaders } from "#lib/api-client";
import { tenantIdSchema } from "#lib/auth-input";
import { redirectToLogin, requirePublicSession } from "#lib/auth-session";
import { isUnauthenticatedError } from "#lib/auth-shared";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema } from "#lib/locale-form";
import { recordIdSchema } from "#lib/record-id";
import { getTenantSiteInfo } from "#lib/tenant";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const seriesFormSchema = z.object({
  locale: localeFormSchema,
  seriesPublicId: z.string().trim().min(1).max(64),
  tenantId: tenantIdSchema,
});

const volumeCheckoutFormSchema = seriesFormSchema.extend({
  volumeId: recordIdSchema,
});

const remainderCheckoutFormSchema = seriesFormSchema.extend({
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
 * Anything else is the page's `checkout=error` notice.
 */
const startCheckout = async (
  { locale, seriesPublicId, tenantId }: SeriesForm,
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
      seriesPublicId: "value",
      tenantId: "value",
      volumeId: "value",
    })
  );

  if (!parsed.success) {
    redirect("/");
  }

  const { tenantId, volumeId } = parsed.data;
  await startCheckout(parsed.data, (sessionId) =>
    apiClient.purchase.startVolumeCheckout(
      { tenant: { tenantId }, volumeId },
      buildSessionHeaders(sessionId)
    )
  );
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
      seriesId: "value",
      seriesPublicId: "value",
      tenantId: "value",
    })
  );

  if (!parsed.success) {
    redirect("/");
  }

  const { locale, seriesId, tenantId } = parsed.data;
  await startCheckout(parsed.data, (sessionId) =>
    apiClient.purchase.startSeriesRemainderCheckout(
      { locale, seriesId, tenant: { tenantId } },
      buildSessionHeaders(sessionId)
    )
  );
};
