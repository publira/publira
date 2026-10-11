"use server";

import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { ClientSurface } from "@publira/api-client/public/types";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { apiClient, buildSessionHeaders } from "#lib/api-client";
import { tenantIdSchema } from "#lib/auth-input";
import { redirectToLogin, requirePublicSession } from "#lib/auth-session";
import { isUnauthenticatedError } from "#lib/auth-shared";
import { tenantReaderAccessTag } from "#lib/cache-tags";
import { assertSameOrigin } from "#lib/csrf";
import { localeFormSchema } from "#lib/locale-form";
import { recordIdSchema } from "#lib/record-id";
import { getTenantSiteInfo } from "#lib/tenant";
import { tenantLocalePath } from "#lib/tenant-locale-path";

const publicIDFormSchema = z.string().trim().min(1).max(64);

const episodeFormSchema = z.object({
  episodeId: recordIdSchema,
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
  const parsed = episodeFormSchema.safeParse(
    toFormDataInput(formData, {
      episodeId: "value",
      episodePublicId: "value",
      locale: "value",
      seriesPublicId: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    redirect("/");
  }

  const { episodeId, episodePublicId, locale, seriesPublicId, tenantId } =
    parsed.data;
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
        episodeId,
        tenant: { tenantId },
      },
      buildSessionHeaders(sessionId)
    );
    checkoutURL = response.checkoutUrl.trim();
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      await redirectToLogin(locale, returnTo, tenantId);
    }
    // Already bought, or refused for a reason the episode page states: free,
    // sold in the app alone, or a tenant that cannot take payments right now.
    if (
      isRpcError(error, Code.AlreadyExists) ||
      isRpcError(error, Code.FailedPrecondition)
    ) {
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

const waitFreeErrorPath = (
  seriesPublicId: string,
  episodePublicId: string
): string => `${episodePath(seriesPublicId, episodePublicId)}?wait_free=error`;

/**
 * Spend the reader's wait-for-free ticket on the episode, and come back to it.
 *
 * Every answer but a failure to reach the API leads back to the episode
 * itself, which reads the reader's access and ticket again and says what
 * holds now: the body once the ticket opened it, and otherwise why it did not
 * — an episode already open, one of the latest the rule keeps a ticket off, a
 * ticket still recharging, a rule an editor turned off, an age the reader has
 * not proved. Those are the states the gate already words, so the Action does
 * not word them a second time.
 */
export const openWithWaitFreeTicketAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const parsed = episodeFormSchema.safeParse(
    toFormDataInput(formData, {
      episodeId: "value",
      episodePublicId: "value",
      locale: "value",
      seriesPublicId: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    redirect("/");
  }

  const { episodeId, episodePublicId, locale, seriesPublicId, tenantId } =
    parsed.data;
  const returnTo = episodePath(seriesPublicId, episodePublicId);
  const sessionId = await requirePublicSession(locale, returnTo, tenantId);

  let failed = false;
  try {
    await apiClient.waitFree.useTicket(
      {
        episodeId,
        surface: ClientSurface.WEB,
        tenant: { tenantId },
      },
      buildSessionHeaders(sessionId)
    );
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      await redirectToLogin(locale, returnTo, tenantId);
    }
    rethrowUnclassifiedRpcError(error);
    // Too many attempts, or an API that could not be reached: nothing the
    // episode can show tells the reader the ticket was not used.
    failed = !isRpcError(
      error,
      Code.AlreadyExists,
      Code.FailedPrecondition,
      Code.NotFound,
      Code.PermissionDenied
    );
  }

  // A refusal changes what the gate says as well — a ticket that was not ready
  // after all is a countdown now — so the reads are dropped either way.
  updateTag(tenantReaderAccessTag(tenantId));
  const returnPath = await tenantLocalePath(
    tenantId,
    locale,
    failed ? waitFreeErrorPath(seriesPublicId, episodePublicId) : returnTo
  );
  redirect(returnPath);
};
