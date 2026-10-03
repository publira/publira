import { tenantOrigin } from "@publira/utils/tenant-origin";

/** The storefront origin, or `undefined` when the tenant has no domain. */
export const storefrontOrigin = (domain: string): string | undefined =>
  tenantOrigin(domain) ?? undefined;

/** The payment webhook a provider is told to call, on the storefront origin. */
export const tenantWebhookUrl = (
  domain: string,
  provider: string
): string | undefined => {
  const origin = storefrontOrigin(domain);
  return origin ? `${origin}/api/v1/webhook/payment/${provider}` : undefined;
};

/** A provider a reader signs in to the storefront with. */
export type SignInProvider = "apple" | "google";

/**
 * Where the provider posts its answer once a reader has signed in, on the
 * storefront origin. The provider refuses any address the tenant has not
 * registered with it, so this has to match the storefront's callback route.
 */
export const signInCallbackUrl = (
  domain: string,
  provider: SignInProvider
): string | undefined => {
  const origin = storefrontOrigin(domain);
  return origin ? `${origin}/api/v1/auth/${provider}/callback` : undefined;
};

/**
 * Where Apple posts the answer to the Android app's sign-in, which runs Apple's
 * web flow with the storefront's Services ID. The storefront hands the answer
 * on to the app, and Apple refuses this address too unless it is registered as
 * a Return URL beside {@link signInCallbackUrl}'s.
 */
export const appleAndroidCallbackUrl = (domain: string): string | undefined => {
  const callback = signInCallbackUrl(domain, "apple");
  return callback ? `${callback}/android` : undefined;
};
