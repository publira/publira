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
import { tenantIdFormSchema } from "#lib/auth-input";

import { episodeLoginHref } from "./access-gate";

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
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    redirect(episodeLoginHref(seriesPublicId, episodePublicId));
  }

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
    if (isRpcError(error, Code.Unauthenticated)) {
      redirect(episodeLoginHref(seriesPublicId, episodePublicId));
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
