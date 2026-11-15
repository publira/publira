import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  Code,
  isMissingResourceRpcError,
  isRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import type { GetBrowserCheckoutResponse } from "@publira/api-client/public/catalog";
import type { Locale } from "@publira/i18n";
import { z } from "zod";

import { apiClient } from "#lib/api-client";
import { getMessagesFor } from "#lib/messages";

import { jsonObjectSchema } from "./checkout-scripts";
import type { JsonObject } from "./checkout-scripts";

/** What the page hands the provider's script, and where it then sends the reader. */
export interface BrowserCheckout {
  credentials: Readonly<Record<string, string>>;
  payload: Readonly<JsonObject>;
  successUrl: string;
  cancelUrl: string;
}

/**
 * What `GetBrowserCheckout` answered: the checkout, a checkout the tenant does
 * not hold, one that can no longer be paid, or a read that failed with the
 * message to show for it.
 */
export type BrowserCheckoutRead =
  | { kind: "open"; checkout: BrowserCheckout }
  | { kind: "missing" }
  | { kind: "closed" }
  | { kind: "failed"; message: string };

/**
 * The page sends the reader to these with `location.assign`, which would run a
 * `javascript:` URL, so only a web address is taken.
 */
const returnURLSchema = z.url({ protocol: /^https?$/u });

const browserCheckoutSchema = z.object({
  cancelUrl: returnURLSchema,
  credentials: z.record(z.string(), z.string()),
  payload: z
    .string()
    .transform((value, context) => {
      try {
        return JSON.parse(value);
      } catch {
        context.addIssue({ code: "custom", message: "invalid JSON" });

        return z.NEVER;
      }
    })
    .pipe(jsonObjectSchema),
  successUrl: returnURLSchema,
});

export const toBrowserCheckout = (
  response: Pick<
    GetBrowserCheckoutResponse,
    "cancelUrl" | "credentials" | "payload" | "successUrl"
  >
): BrowserCheckout | null => {
  const parsed = browserCheckoutSchema.safeParse(response);

  return parsed.success ? parsed.data : null;
};

/**
 * Reads the checkout the page at `/pay/{provider}/{checkout_id}` runs. It is
 * read on every request and never cached: the same checkout stops being
 * payable once it is paid or its lifetime passes, and the page must then say
 * so instead of launching the script again.
 */
export const readBrowserCheckout = async ({
  checkoutId,
  locale,
  provider,
  tenantId,
}: {
  checkoutId: string;
  locale: Locale;
  provider: string;
  tenantId: string;
}): Promise<BrowserCheckoutRead> => {
  const t = await getMessagesFor(locale);
  let response: GetBrowserCheckoutResponse;

  try {
    response = await apiClient.purchase.getBrowserCheckout({
      checkoutId,
      provider,
      tenant: { tenantId },
    });
  } catch (error) {
    if (isMissingResourceRpcError(error)) {
      return { kind: "missing" };
    }

    if (isRpcError(error, Code.FailedPrecondition)) {
      return { kind: "closed" };
    }

    rethrowUnclassifiedRpcError(error);

    return {
      kind: "failed",
      message: rpcErrorMessage(error, t("storefront.pay.load_failed"), {
        locale,
      }),
    };
  }

  const checkout = toBrowserCheckout(response);

  return checkout
    ? { checkout, kind: "open" }
    : { kind: "failed", message: t("storefront.pay.load_failed") };
};
