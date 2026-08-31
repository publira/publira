"use server";

import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "#lib/api-client";
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

const markAsReadSchema = z.object({
  episodePublicId: publicIDFormSchema,
  tenantId: tenantIdSchema,
});

/**
 * Record that the signed-in member has finished reading this episode.
 *
 * A guest is left alone: no login redirect, no anonymous row. Reaching the
 * last page is not a request to sign in, and the reader already has what they
 * came for. The same goes for an episode this member may no longer read — the
 * API re-checks publication and paid-body access on the write itself and
 * answers `NotFound`, so nothing here decides on its behalf.
 *
 * The boolean is what the viewer suppresses repeat sends with: `true` means a
 * record stands and no second attempt is needed, and `false` means the next
 * arrival at the last page may try again. It says nothing to the reader —
 * there is no read badge on this screen yet (#1227) — so a rejection is not
 * worded, only reported.
 */
export const markEpisodeAsReadAction = async (input: {
  episodePublicId: string;
  tenantId: string;
}): Promise<boolean> => {
  await assertSameOrigin();
  const parsed = markAsReadSchema.safeParse(input);
  if (!parsed.success) {
    return false;
  }

  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return false;
  }

  const { episodePublicId, tenantId } = parsed.data;
  try {
    await apiClient.episodeRead.markEpisodeAsRead(
      { episodePublicId, tenant: { tenantId } },
      buildSessionHeaders(sessionId)
    );
    return true;
  } catch (error) {
    // An expired session, an episode that has since been unpublished, an
    // entitlement that has run out: each is an answer, and none of them is
    // something to interrupt the reader over. Anything unclassifiable is a
    // real failure and still reaches the caller, which fails the Action alone
    // and leaves the viewer running.
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

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
