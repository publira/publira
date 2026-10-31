"use server";

import {
  Code,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { apiClient, buildSessionHeaders } from "./api-client";
import { tenantIdSchema } from "./auth-input";
import { redirectToLogin, requirePublicSession } from "./auth-session";
import { isUnauthenticatedError } from "./auth-shared";
import { coinsPagePath, episodeCoinsPath } from "./coins-path";
import type { CoinPackCheckoutOutcome } from "./coins-path";
import { assertSameOrigin } from "./csrf";
import { localeFormSchema } from "./locale-form";
import { recordIdSchema } from "./record-id";
import { tenantLocalePath } from "./tenant-locale-path";

const publicIDFormSchema = z.string().trim().min(1).max(64);

/**
 * A pack bought from an episode's gate names the episode, so the checkout
 * sends the reader back to it; one bought from `/my/coins` names none.
 */
const coinPackCheckoutFormSchema = z.union([
  z.object({
    coinPackId: recordIdSchema,
    episodeId: recordIdSchema,
    episodePublicId: publicIDFormSchema,
    locale: localeFormSchema,
    seriesPublicId: publicIDFormSchema,
    tenantId: tenantIdSchema,
  }),
  z.object({
    coinPackId: recordIdSchema,
    episodeId: z.undefined(),
    locale: localeFormSchema,
    tenantId: tenantIdSchema,
  }),
]);

/**
 * Hand the reader to the payment provider's checkout of a pack of the
 * tenant's coins, and have it send them back to the episode they were short
 * of coins for, or to `/my/coins`.
 *
 * A pack taken off sale, or a tenant that stopped selling packs or taking
 * payments, is `unavailable` on the page the reader came from, which reads the
 * packs again; anything else is `error`.
 */
export const startCoinPackCheckoutAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();

  const parsed = coinPackCheckoutFormSchema.safeParse(
    toFormDataInput(formData, {
      coinPackId: "value",
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

  const { coinPackId, locale, tenantId } = parsed.data;

  // Locale-less, the shape `sanitizeRedirectPath` stores; only the
  // `redirect()` targets below take a prefix.
  const fromPath = (outcome?: CoinPackCheckoutOutcome): string => {
    if (parsed.data.episodeId === undefined) {
      return coinsPagePath(outcome);
    }

    const { episodePublicId, seriesPublicId } = parsed.data;

    return episodeCoinsPath(
      seriesPublicId,
      episodePublicId,
      outcome && (outcome === "error" ? "pack_error" : "pack_unavailable")
    );
  };

  const sessionId = await requirePublicSession(locale, fromPath(), tenantId);

  let checkoutURL = "";
  let outcome: CoinPackCheckoutOutcome | null = null;

  try {
    const response = await apiClient.coin.startCoinPackCheckout(
      {
        coinPackId,
        locale,
        returnEpisodeId: parsed.data.episodeId ?? "",
        tenant: { tenantId },
      },
      buildSessionHeaders(sessionId)
    );

    checkoutURL = response.checkoutUrl.trim();
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      await redirectToLogin(locale, fromPath(), tenantId);
    }

    rethrowUnclassifiedRpcError(error);
    outcome = isRpcError(error, Code.FailedPrecondition, Code.NotFound)
      ? "unavailable"
      : "error";
  }

  if (outcome || !checkoutURL) {
    redirect(
      await tenantLocalePath(tenantId, locale, fromPath(outcome ?? "error"))
    );
  }

  redirect(checkoutURL);
};
