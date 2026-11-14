import type { TenantPaymentProvider } from "@publira/api-client/public/tenant";
import { z } from "zod";

/** A web payment provider a reader can pay the tenant through right now. */
export interface PaymentProviderOption {
  /** The id a checkout names it by, such as `stripe`. */
  id: string;
  displayName: string;
  /** Whether the tenant's subscription plans are sold through it. */
  subscriptions: boolean;
}

/**
 * The providers `GetTenant` answers, in the order the tenant added them. One
 * without an id is left out, since no checkout could name it, and one without
 * a display name is shown by its id.
 */
export const toPaymentProviderOptions = (
  providers: readonly Pick<
    TenantPaymentProvider,
    "displayName" | "id" | "subscriptions"
  >[]
): PaymentProviderOption[] =>
  providers.flatMap(({ displayName, id, subscriptions }) => {
    const trimmedId = id.trim();

    return trimmedId
      ? [
          {
            displayName: displayName.trim() || trimmedId,
            id: trimmedId,
            subscriptions,
          },
        ]
      : [];
  });

/**
 * Whether the site can sell a subscription plan: through the provider the
 * plans are sold through. A server of the previous release lists no provider
 * while it takes payments, and sells plans whenever it takes payments, as the
 * site did before it could list them.
 */
export const sellsSubscriptions = ({
  acceptsPayments,
  paymentProviders,
}: {
  acceptsPayments: boolean;
  paymentProviders: readonly PaymentProviderOption[];
}): boolean =>
  paymentProviders.length === 0
    ? acceptsPayments
    : paymentProviders.some(({ subscriptions }) => subscriptions);

/**
 * The provider a checkout form posts: the one the reader chose, or empty where
 * the site offers no choice, which the API reads as the one provider the
 * tenant sells through.
 */
export const paymentProviderFormSchema = z.string().trim().max(64).default("");
