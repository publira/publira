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
