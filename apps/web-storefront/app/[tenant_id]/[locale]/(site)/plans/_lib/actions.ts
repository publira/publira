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
import { tenantLocalePath } from "#lib/tenant-locale-path";

import { plansPath } from "./plans-path";

const subscribeFormSchema = z.object({
  locale: localeFormSchema,
  planId: recordIdSchema,
  tenantId: tenantIdSchema,
});

/**
 * Hand the reader to Stripe's checkout of the plan they chose, starting from
 * the plan page and coming back to `/my` once they pay or to the plan page if
 * they leave.
 *
 * A reader who already holds a subscription goes to `/my`, where their plan
 * and the way to change it are. A plan taken off the site, or a site that can
 * no longer sell plans, is `subscription=unavailable` on the plan page, which
 * reads the plans again; anything else is `subscription=error`.
 */
export const startSubscriptionCheckoutAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const parsed = subscribeFormSchema.safeParse(
    toFormDataInput(formData, {
      locale: "value",
      planId: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    redirect("/");
  }

  const { locale, planId, tenantId } = parsed.data;
  // `returnTo` stays locale-less, the shape `sanitizeRedirectPath` stores;
  // only the `redirect()` targets below take a prefix.
  const returnTo = plansPath();
  const sessionId = await requirePublicSession(locale, returnTo, tenantId);

  let checkoutURL = "";
  let outcome: "error" | "held" | "unavailable" | null = null;
  try {
    const response = await apiClient.subscription.startSubscriptionCheckout(
      { planId, tenant: { tenantId } },
      buildSessionHeaders(sessionId)
    );
    checkoutURL = response.checkoutUrl.trim();
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      await redirectToLogin(locale, returnTo, tenantId);
    }
    rethrowUnclassifiedRpcError(error);
    if (isRpcError(error, Code.AlreadyExists)) {
      outcome = "held";
    } else if (isRpcError(error, Code.FailedPrecondition, Code.NotFound)) {
      outcome = "unavailable";
    } else {
      outcome = "error";
    }
  }
  if (outcome === "held") {
    redirect(await tenantLocalePath(tenantId, locale, "/my"));
  }
  if (outcome || !checkoutURL) {
    redirect(
      await tenantLocalePath(
        tenantId,
        locale,
        plansPath(outcome === "unavailable" ? "unavailable" : "error")
      )
    );
  }
  redirect(checkoutURL);
};
