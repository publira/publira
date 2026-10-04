import type { EmailRefusal } from "./auth";
import type { HostMessageAccessor } from "./messages";

/**
 * What a form says about an address the tenant refuses, or `fallback` when the
 * address was not what the API refused. Sign-up and the email change word it
 * alike: either way the reader is asked for another address.
 */
export const emailRefusalMessage = (
  t: HostMessageAccessor,
  refusal: EmailRefusal | undefined,
  fallback: string
): string => {
  switch (refusal) {
    case "disposable_domain": {
      return t("host.auth.errors.email_disposable_domain");
    }
    case "refused": {
      return t("host.auth.errors.email_refused");
    }
    default: {
      return fallback;
    }
  }
};
