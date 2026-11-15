import { z } from "zod";

/** A JSON object, the shape a provider's script is launched with. */
export const jsonObjectSchema = z.record(z.string(), z.json());

export type JsonObject = z.output<typeof jsonObjectSchema>;

/**
 * What the reader types on the page for the provider's script, which the
 * server holds nothing of: their name, and the address they are billed at.
 */
export interface CheckoutBuyer {
  familyName: string;
  givenName: string;
  /** `NNN-NNNN`. */
  postalCode: string;
  prefecture: string;
  city: string;
  /** The district and the lot number. */
  addressLine: string;
  /** The building and the room, or empty. */
  building: string;
}

/**
 * How the reader left the provider's script: with a payment it authorized,
 * which the server is then handed, or without one.
 */
export type CheckoutOutcome =
  | { authorized: true; paymentId: string }
  | { authorized: false };

export interface CheckoutLaunch {
  /** The tenant's public credential values, keyed by field name. */
  credentials: Readonly<Record<string, string>>;
  /** What `GetBrowserCheckout` answered to launch the script with. */
  payload: Readonly<JsonObject>;
  buyer: CheckoutBuyer;
}

/** A provider's script, as the page loads and launches it. */
export interface CheckoutScript {
  /** Where the page loads the script from. */
  src: string;
  /**
   * Opens the provider's checkout and settles once the reader leaves it. It
   * rejects when the script has not loaded.
   */
  launch: (launch: CheckoutLaunch) => Promise<CheckoutOutcome>;
}

/**
 * What Paidy Checkout's `closed` callback is handed: the payment's id, which
 * a checkout closed early leaves out, and its status.
 */
const paidyClosedSchema = z.object({
  id: z.string().trim().optional(),
  status: z.string(),
});

export type PaidyClosedData = z.input<typeof paidyClosedSchema>;

interface PaidyHandler {
  launch: (payload: JsonObject) => void;
}

interface PaidyConfig {
  api_key: string;
  closed: (callbackData: PaidyClosedData) => void;
}

export interface PaidyGlobal {
  configure: (config: PaidyConfig) => PaidyHandler;
}

declare global {
  interface Window {
    Paidy?: PaidyGlobal;
  }
}

/** The credential field the tenant's public key is saved under. */
export const PAIDY_PUBLIC_KEY_FIELD = "public_key";

/** `value` when it is an object, so the page's fields add to what it holds. */
const asObject = (value: JsonObject[string] | undefined): JsonObject => {
  const parsed = jsonObjectSchema.safeParse(value);

  return parsed.success ? parsed.data : {};
};

/**
 * The payload Paidy Checkout is launched with: the server's, with the buyer's
 * name and the address the reader typed. Paidy requires a billing address and
 * a shipping address, and what is sold here is never shipped, so the billing
 * address stands for both.
 */
export const paidyPayload = ({
  buyer,
  payload,
}: Pick<CheckoutLaunch, "buyer" | "payload">) => {
  const address = {
    city: buyer.city,
    ...(buyer.building && { line1: buyer.building }),
    line2: buyer.addressLine,
    state: buyer.prefecture,
    zip: buyer.postalCode,
  };

  return {
    ...payload,
    buyer: {
      ...asObject(payload.buyer),
      name1: `${buyer.familyName} ${buyer.givenName}`,
    },
    buyer_data: {
      ...asObject(payload.buyer_data),
      billing_address: address,
    },
    shipping_address: address,
  };
};

/**
 * Paidy Checkout (https://paidy.com/docs/en/paidycheckout.html). Its `closed`
 * callback answers `authorized` with the payment's id, and `rejected` or
 * `closed` without a payment the server could complete the checkout with. The
 * documentation writes the status in either case, so it is compared without.
 */
const paidy: CheckoutScript = {
  launch: ({ buyer, credentials, payload }) => {
    const script = window.Paidy;

    if (!script) {
      return Promise.reject(new Error("paidy.js has not loaded"));
    }

    const { promise, resolve } = Promise.withResolvers<CheckoutOutcome>();

    const handler = script.configure({
      api_key: credentials[PAIDY_PUBLIC_KEY_FIELD] ?? "",
      closed: (callbackData) => {
        const parsed = paidyClosedSchema.safeParse(callbackData);
        const paymentId = parsed.success ? (parsed.data.id ?? "") : "";

        resolve(
          parsed.success &&
            parsed.data.status.toLowerCase() === "authorized" &&
            paymentId
            ? { authorized: true, paymentId }
            : { authorized: false }
        );
      },
    });

    handler.launch(paidyPayload({ buyer, payload }));

    return promise;
  },
  src: "https://apps.paidy.com/",
};

const checkoutScripts: ReadonlyMap<string, CheckoutScript> = new Map([
  ["paidy", paidy],
]);

/**
 * The script of the provider `providerId` names, or `null` for one whose
 * checkouts this build cannot run.
 */
export const checkoutScriptOf = (providerId: string): CheckoutScript | null =>
  checkoutScripts.get(providerId) ?? null;
