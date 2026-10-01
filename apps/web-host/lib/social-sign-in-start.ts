import { redirect } from "next/navigation";

import { getMessagesFor } from "./messages";
import {
  buildAuthorizationUrl,
  signInCallbackPath,
  signInSecret,
  writeSignInRequest,
} from "./social-sign-in";
import type { SignInRequest } from "./social-sign-in";
import { signInFailurePath } from "./social-sign-in-paths";
import { getTenantPublicOrigin, getTenantSignInClients } from "./tenant";

/**
 * Send the reader to the provider, remembering the nonce and the state its
 * answer has to match beside what the caller asked the sign-in for.
 *
 * Kept out of the `"use server"` modules that call it: every async function
 * such a module exports is an endpoint, and this one trusts its arguments.
 */
export const sendToProvider = async (
  request: Omit<SignInRequest, "nonce" | "redirectUri" | "state">
): Promise<never> => {
  const { locale, provider, tenantId } = request;
  const [clients, origin] = await Promise.all([
    getTenantSignInClients(tenantId),
    getTenantPublicOrigin(tenantId),
  ]);
  const clientId = clients[provider];
  if (!clientId || !origin) {
    const t = await getMessagesFor(locale);
    redirect(
      await signInFailurePath(request, t("host.auth.social.errors.unavailable"))
    );
  }

  const nonce = signInSecret();
  const state = signInSecret();
  const redirectUri = `${origin}${signInCallbackPath(provider)}`;
  await writeSignInRequest({ ...request, nonce, redirectUri, state });
  redirect(
    buildAuthorizationUrl({ clientId, nonce, provider, redirectUri, state })
  );
};
