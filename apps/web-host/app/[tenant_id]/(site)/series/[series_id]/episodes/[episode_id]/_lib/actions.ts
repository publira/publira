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
import { tenantIdFormSchema } from "#lib/auth-input";
import { redirectToLogin, requirePublicSession } from "#lib/auth-session";
import { isUnauthenticatedError } from "#lib/auth-shared";
import { getTenantSiteInfo } from "#lib/tenant";

const publicIDFormSchema = z.string().trim().min(1).max(64);

const checkoutFormSchema = z.object({
  episodePublicId: publicIDFormSchema,
  seriesPublicId: publicIDFormSchema,
  tenantId: tenantIdFormSchema,
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
  const parsed = checkoutFormSchema.safeParse(
    toFormDataInput(formData, {
      episodePublicId: "value",
      seriesPublicId: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    redirect("/");
  }

  const { episodePublicId, seriesPublicId, tenantId } = parsed.data;
  // `returnTo` is the episode itself. Handing `episodeLoginHref()` to these
  // helpers would give them a `/login?...` URL, which `sanitizeRedirectPath`
  // rejects — the reader would come back to the tenant home instead.
  const returnTo = episodePath(seriesPublicId, episodePublicId);
  // Guard crafted form posts as well as the hidden CTA. A failed availability
  // read is not permission to attempt Checkout.
  const tenant = await getTenantSiteInfo(tenantId);
  if (!tenant?.acceptsPayments) {
    redirect(returnTo);
  }
  const sessionId = await requirePublicSession(returnTo);

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
      redirectToLogin(returnTo);
    }
    if (isRpcError(error, Code.AlreadyExists)) {
      redirect(episodePath(seriesPublicId, episodePublicId));
    }
    rethrowUnclassifiedRpcError(error);
    redirect(checkoutErrorPath(seriesPublicId, episodePublicId));
  }
  if (!checkoutURL) {
    redirect(checkoutErrorPath(seriesPublicId, episodePublicId));
  }
  redirect(checkoutURL);
};
