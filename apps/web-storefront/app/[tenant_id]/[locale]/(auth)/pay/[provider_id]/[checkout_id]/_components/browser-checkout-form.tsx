"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import Script from "next/script";
import type { ReactNode } from "react";
import { z } from "zod";

import { useClientMessages } from "#components/client-message";
import type { StorefrontClientMessageAccessor } from "#lib/messages";

import { completeBrowserCheckoutAction } from "../_lib/actions";
import type { BrowserCheckout } from "../_lib/browser-checkout";
import { checkoutScriptOf } from "../_lib/checkout-scripts";
import type {
  CheckoutBuyer,
  CheckoutLaunch,
  CheckoutOutcome,
  CheckoutScript,
} from "../_lib/checkout-scripts";
import { leavePage } from "../_lib/leave-page";

/**
 * What a submission leaves behind. A payment the script authorized that the
 * server could not be handed yet is kept, so the next press hands it over
 * again instead of opening the provider's checkout for a second payment.
 */
interface BrowserCheckoutState extends ActionForm.Result {
  paymentId?: string;
}

/** `1234567`, `123-4567`, and their full-width forms, as `123-4567`. */
const POSTAL_CODE = /^(?<head>\d{3})-?(?<tail>\d{4})$/u;

const buyerSchema = (t: StorefrontClientMessageAccessor) => {
  const required = (key: Parameters<StorefrontClientMessageAccessor>[0]) =>
    z
      .string()
      .trim()
      .min(1, { error: t(key) });

  return z.object({
    addressLine: required("storefront.pay.errors.address_line_required"),
    building: z.string().trim(),
    city: required("storefront.pay.errors.city_required"),
    familyName: required("storefront.pay.errors.family_name_required"),
    givenName: required("storefront.pay.errors.given_name_required"),
    postalCode: z
      .string()
      .transform((value) => value.normalize("NFKC").trim())
      .transform((value, context) => {
        const groups = POSTAL_CODE.exec(value)?.groups;

        if (!groups) {
          context.addIssue({
            code: "custom",
            message: t("storefront.pay.errors.postal_code_invalid"),
          });

          return z.NEVER;
        }

        return `${groups.head}-${groups.tail}`;
      }),
    prefecture: required("storefront.pay.errors.prefecture_required"),
  }) satisfies z.ZodType<CheckoutBuyer, unknown>;
};

const BUYER_FIELDS = [
  "addressLine",
  "building",
  "city",
  "familyName",
  "givenName",
  "postalCode",
  "prefecture",
] as const satisfies readonly (keyof CheckoutBuyer)[];

/** The field the payment the script authorized reaches the Action in. */
const PAYMENT_ID_FIELD = "paymentId";

/**
 * Opens the provider's checkout, or answers `null` when it cannot be opened:
 * the script has not loaded, or it threw.
 */
const openCheckout = async (
  script: CheckoutScript,
  launch: CheckoutLaunch
): Promise<CheckoutOutcome | null> => {
  try {
    return await script.launch(launch);
  } catch {
    return null;
  }
};

/**
 * Hands the server the payment, and sends the reader to the success URL once
 * it has been taken.
 */
const complete = async (
  formData: FormData,
  paymentId: string,
  successUrl: string
): Promise<BrowserCheckoutState> => {
  formData.set(PAYMENT_ID_FIELD, paymentId);
  const completed = await completeBrowserCheckoutAction(formData);

  if (!completed.ok) {
    return { ...completed, paymentId };
  }

  leavePage(successUrl);

  return completed;
};

/**
 * The form that opens the provider's checkout with what the reader typed into
 * `children`. Once the reader leaves it, the payment it authorized is handed to
 * the server and the reader sent to the checkout's success URL; a checkout
 * closed without one sends them to its cancel URL and hands over nothing.
 */
const BrowserCheckoutFormRoot = ({
  checkout,
  checkoutId,
  children,
  providerId,
}: {
  checkout: BrowserCheckout;
  checkoutId: string;
  children: ReactNode;
  providerId: string;
}) => {
  const t = useClientMessages();
  const script = checkoutScriptOf(providerId);

  const pay = async (
    previousState: BrowserCheckoutState | null,
    formData: FormData
  ): Promise<BrowserCheckoutState> => {
    if (previousState?.paymentId) {
      return complete(formData, previousState.paymentId, checkout.successUrl);
    }

    const parsed = buyerSchema(t).safeParse(
      Object.fromEntries(
        BUYER_FIELDS.map((field) => [field, formData.get(field) ?? ""])
      )
    );

    if (!parsed.success) {
      return {
        message: parsed.error.issues[0]?.message ?? "",
        ok: false,
      };
    }

    const outcome = script
      ? await openCheckout(script, {
          buyer: parsed.data,
          credentials: checkout.credentials,
          payload: checkout.payload,
        })
      : null;

    if (!outcome) {
      return {
        message: t("storefront.pay.errors.script_unavailable"),
        ok: false,
      };
    }

    if (!outcome.authorized) {
      leavePage(checkout.cancelUrl);

      return { message: "", ok: true };
    }

    return complete(formData, outcome.paymentId, checkout.successUrl);
  };

  return (
    <>
      {script ? <Script src={script.src} /> : null}
      <ActionForm.Root action={pay} className="grid gap-4" showSuccess={false}>
        <input name="provider" type="hidden" value={providerId} />
        <input name="checkoutId" type="hidden" value={checkoutId} />
        {children}
      </ActionForm.Root>
    </>
  );
};

/** What the button says before a payment has been authorized. */
const BrowserCheckoutFormLaunch = ({ children }: { children: ReactNode }) =>
  ActionForm.useState<BrowserCheckoutState>()?.paymentId ? null : children;

/**
 * What the button says once a payment was authorized and the server could not
 * be handed it, which pressing it hands over again.
 */
const BrowserCheckoutFormRetry = ({ children }: { children: ReactNode }) =>
  ActionForm.useState<BrowserCheckoutState>()?.paymentId ? children : null;

export {
  BrowserCheckoutFormLaunch as Launch,
  BrowserCheckoutFormRetry as Retry,
  BrowserCheckoutFormRoot as Root,
};
