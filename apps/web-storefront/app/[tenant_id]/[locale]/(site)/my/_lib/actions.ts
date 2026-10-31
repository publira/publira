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
import { tenantLocalePath } from "#lib/tenant-locale-path";

const billingFormSchema = z.object({
  locale: localeFormSchema,
  tenantId: tenantIdSchema,
});

/**
 * Hand the reader to Stripe's billing portal, where they change their payment
 * method, see their invoices, and cancel; the portal returns them to `/my`.
 *
 * A reader who has never subscribed, or a site that no longer takes payments
 * through Stripe, is `billing=unavailable`; anything else is `billing=error`.
 */
export const openBillingPortalAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();

  const parsed = billingFormSchema.safeParse(
    toFormDataInput(formData, { locale: "value", tenantId: "value" })
  );

  if (!parsed.success) {
    redirect("/");
  }

  const { locale, tenantId } = parsed.data;
  const returnTo = "/my";
  const sessionId = await requirePublicSession(locale, returnTo, tenantId);

  let portalURL = "";
  let failure: "error" | "unavailable" | null = null;

  try {
    const response = await apiClient.subscription.createBillingPortalSession(
      { tenant: { tenantId } },
      buildSessionHeaders(sessionId)
    );

    portalURL = response.url.trim();
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      await redirectToLogin(locale, returnTo, tenantId);
    }

    rethrowUnclassifiedRpcError(error);
    failure = isRpcError(error, Code.FailedPrecondition)
      ? "unavailable"
      : "error";
  }

  if (failure || !portalURL) {
    redirect(
      await tenantLocalePath(
        tenantId,
        locale,
        `${returnTo}?billing=${failure ?? "error"}`
      )
    );
  }

  redirect(portalURL);
};
