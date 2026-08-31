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
import { getTenantSiteInfo } from "#lib/tenant";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const publicIDFormSchema = z.string().trim().min(1).max(64);

const checkoutFormSchema = z.object({
  episodePublicId: publicIDFormSchema,
  locale: localeFormSchema,
  seriesPublicId: publicIDFormSchema,
  tenantId: tenantIdSchema,
});

const episodePath = (seriesPublicId: string, episodePublicId: string): string =>
  `/series/${seriesPublicId}/episodes/${episodePublicId}`;

const checkoutErrorPath = (
  seriesPublicId: string,
  episodePublicId: string
): string => `${episodePath(seriesPublicId, episodePublicId)}?checkout=error`;

export const startEpisodeCheckoutAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const parsed = checkoutFormSchema.safeParse(
    toFormDataInput(formData, {
      episodePublicId: "value",
      locale: "value",
      seriesPublicId: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    redirect("/");
  }

  const { episodePublicId, locale, seriesPublicId, tenantId } = parsed.data;
  // `returnTo` is the episode itself. Handing `episodeLoginHref()` to these
  // helpers would give them a `/login?...` URL, which `sanitizeRedirectPath`
  // rejects — the reader would come back to the tenant home instead. It stays
  // locale-less, the shape `sanitizeRedirectPath` stores; only the `redirect()`
  // targets below take a prefix.
  const returnTo = episodePath(seriesPublicId, episodePublicId);
  // Guard crafted form posts as well as the hidden CTA. A failed availability
  // read is not permission to attempt Checkout.
  const tenant = await getTenantSiteInfo(tenantId);
  if (!tenant?.acceptsPayments) {
    const returnPath = await tenantLocalePath(tenantId, locale, returnTo);
    redirect(returnPath);
  }
  const sessionId = await requirePublicSession(locale, returnTo, tenantId);

  let checkoutURL = "";
  try {
    const response = await apiClient.purchase.startEpisodeCheckout(
      {
        episodePublicId,
        tenant: { tenantId },
      },
      buildSessionHeaders(sessionId)
    );
    checkoutURL = response.checkoutUrl.trim();
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      await redirectToLogin(locale, returnTo, tenantId);
    }
    if (isRpcError(error, Code.AlreadyExists)) {
      const returnPath = await tenantLocalePath(tenantId, locale, returnTo);
      redirect(returnPath);
    }
    rethrowUnclassifiedRpcError(error);
    const errorPath = await tenantLocalePath(
      tenantId,
      locale,
      checkoutErrorPath(seriesPublicId, episodePublicId)
    );
    redirect(errorPath);
  }
  if (!checkoutURL) {
    const errorPath = await tenantLocalePath(
      tenantId,
      locale,
      checkoutErrorPath(seriesPublicId, episodePublicId)
    );
    redirect(errorPath);
  }
  redirect(checkoutURL);
};
