"use server";

import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { returnToFormSchema } from "./auth-input";
import { requirePublicSession } from "./auth-session";
import { assertSameOrigin } from "./csrf";
import { localeFormSchema, requireFormLocale } from "./locale-form";
import { getMessagesFor } from "./messages";
import { SIGN_IN_PROVIDERS } from "./sign-in-provider";
import {
  buildAuthorizationUrl,
  SIGN_IN_INTENTS,
  signInCallbackPath,
  signInSecret,
  writeSignInRequest,
} from "./social-sign-in";
import { signInFailurePath } from "./social-sign-in-paths";
import { getTenantPublicOrigin, getTenantSignInClients } from "./tenant";
import { isTenantIdFormat } from "./tenant-id-format";

const startSignInFormSchema = z.object({
  intent: z.enum(SIGN_IN_INTENTS),
  locale: localeFormSchema,
  provider: z.enum(SIGN_IN_PROVIDERS),
  returnTo: returnToFormSchema,
  tenantId: z.string().refine(isTenantIdFormat),
});

/**
 * Send the reader to the provider, remembering the nonce and the state its
 * answer has to match. Confirming a deletion needs the session it deletes, so
 * that intent is refused without one before the reader leaves the site.
 */
export const startSocialSignInAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const submittedLocale = requireFormLocale(formData.get("locale"));
  const parsed = startSignInFormSchema.safeParse(
    toFormDataInput(formData, {
      intent: "value",
      locale: "value",
      provider: "value",
      returnTo: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    // Every field is hidden, so a form that fails here was not the site's.
    throw new Error("the sign-in form was tampered with");
  }

  const { intent, locale, provider, returnTo, tenantId } = parsed.data;
  const accessToken =
    intent === "delete"
      ? await requirePublicSession(locale, "/settings", tenantId)
      : undefined;

  const [clients, origin] = await Promise.all([
    getTenantSignInClients(tenantId),
    getTenantPublicOrigin(tenantId),
  ]);
  const clientId = clients[provider];
  if (!clientId || !origin) {
    const t = await getMessagesFor(submittedLocale);
    redirect(
      await signInFailurePath(
        { intent, locale, returnTo, tenantId },
        t("host.auth.social.errors.unavailable")
      )
    );
  }

  const nonce = signInSecret();
  const state = signInSecret();
  const redirectUri = `${origin}${signInCallbackPath(provider)}`;
  await writeSignInRequest({
    ...(accessToken ? { accessToken } : {}),
    intent,
    locale,
    nonce,
    provider,
    redirectUri,
    returnTo,
    state,
    tenantId,
  });
  redirect(
    buildAuthorizationUrl({ clientId, nonce, provider, redirectUri, state })
  );
};
