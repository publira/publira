import type { EmailRefusal } from "./auth";
import type { StorefrontMessageAccessor } from "./messages";

/**
 * What a form says about an address the tenant refuses, or `fallback` when the
 * address was not what the API refused. Sign-up and the email change word it
 * alike: either way the reader is asked for another address.
 */
export const emailRefusalMessage = (
  t: StorefrontMessageAccessor,
  refusal: EmailRefusal | undefined,
  fallback: string
): string => {
  switch (refusal) {
    case "disposable_domain": {
      return t("storefront.auth.errors.email_disposable_domain");
    }
    case "refused": {
      return t("storefront.auth.errors.email_refused");
    }
    default: {
      return fallback;
    }
  }
};
